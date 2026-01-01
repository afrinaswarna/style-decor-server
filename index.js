const express = require("express");
const app = express();
const cors = require("cors");
require("dotenv").config();
const stripe = require("stripe")(process.env.STRIP_SECRET);
const port = process.env.PORT || 3000;
const crypto = require("crypto");

function generateTrackingId() {
  const prefix = "PRCL";
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, ""); // YYMMDD
  const random = crypto.randomBytes(3).toString("hex").toUpperCase(); // 6 chars
  return `${prefix}-${date}-${random}`;
}

app.use(cors());
app.use(express.json());
const admin = require("firebase-admin");

const decoded = Buffer.from(process.env.FB_SERVICE_KEY, "base64").toString(
  "utf8"
);

const serviceAccount = JSON.parse(decoded);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.52cv5mu.mongodb.net/?appName=Cluster0`;

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

const verifyFBToken = async (req, res, next) => {
  const token = req.headers.authorization;

  if (!token) {
    return res.status(401).send({ message: "unauthorized access" });
  }
  try {
    const idToken = token.split(" ")[1];
    const decoded = await admin.auth().verifyIdToken(idToken);

    req.decoded_email = decoded.email;
    next();
  } catch (error) {
    return res.status(401).send({ message: "unauthorized access" });
  }
};

async function run() {
  try {
    const db = client.db("style_decor_db_user");
    const userCollection = db.collection("user");
    const serviceCollection = db.collection("service");
    const bookingCollection = db.collection("bookings");
    const paymentCollection = db.collection("payments");
    const decoratorsCollection = db.collection("decorator");

    const verifyAdmin = async (req, res, next) => {
      const email = req.decoded_email;
      query = { email };
      const user = await userCollection.findOne(query);
      if (!user || user.role !== "admin") {
        return res.status(403).send({ massage: "forbidden access" });
      }
      next();
    };
    // user related apis
    app.get("/users", verifyFBToken, async (req, res) => {
      const searchUser = req.query.searchUser;
      const query = {};
      if (searchUser) {
        query.$or = [
          { displayName: { $regex: searchUser, $options: "i" } },
          { email: { $regex: searchUser, $options: "i" } },
        ];
      }
      const cursor = userCollection
        .find(query)
        .sort({ createdAt: -1 })
        .limit(5);
      const result = await cursor.toArray();
      res.send(result);
    });
    app.get("/users/:email/role", async (req, res) => {
      const email = req.params.email;
      const query = { email };
      const user = await userCollection.findOne(query);
      res.send({ role: user?.role || "user" });
    });

    app.post("/users", async (req, res) => {
      const user = req.body;
      user.role = "user";
      user.createdAt = new Date();
      email = user.email;
      const existingUser = await userCollection.findOne({ email });
      if (existingUser) {
        return res.send({ massage: "user exist" });
      }

      const result = await userCollection.insertOne(user);
      res.send(result);
    });
    app.patch(
      "/users/:id/role",
      verifyFBToken,
      verifyAdmin,
      async (req, res) => {
        const id = req.params.id;
        const roleInfo = req.body;
        const query = { _id: new ObjectId(id) };
        const updatedDoc = {
          $set: {
            role: roleInfo.role,
          },
        };
        const result = await userCollection.updateOne(query, updatedDoc);
        res.send(result);
      }
    );

    app.get("/services", async (req, res) => {
      const cursor = serviceCollection.find();
      const result = await cursor.toArray();
      res.send(result);
    });
    app.get("/services/home", async (req, res) => {
      const cursor = serviceCollection.find().limit(8).sort({ cost: -1 });
      const result = await cursor.toArray();
      res.send(result);
    });

    app.get("/services/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await serviceCollection.findOne(query);

      res.send(result);
    });
    app.post("/services", async (req, res) => {
      const services = req.body;
      const result = await serviceCollection.insertOne(services);
      res.send(result);
    });

    app.get("/bookings", async (req, res) => {
      const query = {};

      const { email, serviceStatus } = req.query;
      if (email) {
        query.userEmail = email;
      }
      if (serviceStatus) {
        query.serviceStatus = serviceStatus;
      }
      const options = { sort: { createdAt: -1 } };
      const cursor = bookingCollection.find(query, options);
      const result = await cursor.toArray();
      res.send(result);
    });
    app.get("/bookings/decorator", async (req, res) => {
  const { decoratorEmail, serviceStatus } = req.query;
  const query = {};

  if (decoratorEmail) {
    query.decoratorEmail = decoratorEmail;
  }

  
  if (serviceStatus) {
    if (serviceStatus === "completed") {
      query.serviceStatus = "completed";
    } else {
   
      query.serviceStatus = { $nin: ["completed"] };
    }
  }
 
  const cursor = bookingCollection.find(query);
  const result = await cursor.toArray();
  res.send(result);
});
    app.post("/bookings", async (req, res) => {
      const booking = req.body;

      const result = await bookingCollection.insertOne(booking);
      res.send(result);
    });
    app.patch("/bookings/:id", async (req, res) => {
      try {
        const { decoratorId, decoratorName, decoratorEmail } = req.body;
        const id = req.params.id;

        if (!ObjectId.isValid(id) || !ObjectId.isValid(decoratorId)) {
          return res.status(400).send({ message: "Invalid ID format" });
        }

        const bookingResult = await bookingCollection.updateOne(
          { _id: new ObjectId(id) },
          {
            $set: {
              serviceStatus: "assigned",
              decoratorResponse: "pending",
              decoratorId,
              decoratorName,
              decoratorEmail,
            },
            $push: {
              statusTimeline: {
                status: "assigned",
                updatedAt: new Date(),
                updatedBy: "admin",
              },
            },
          }
        );

        res.send({
          success: true,
          modifiedCount: bookingResult.modifiedCount,
        });
      } catch (error) {
        console.error("Assignment Error:", error);
        res.status(500).send({ message: "Internal Server Error" });
      }
    });
    app.patch("/bookings/:id/accept", verifyFBToken, async (req, res) => {
      const bookingId = req.params.id;
      const email = req.decoded_email;

      const booking = await bookingCollection.findOne({
        _id: new ObjectId(bookingId),
        decoratorEmail: email,
        decoratorResponse: "pending",
        serviceStatus: "assigned",
      });

      if (!booking) {
        return res.status(400).send({ message: "Invalid request" });
      }

      await bookingCollection.updateOne(
        { _id: booking._id },
        {
          $set: {
            decoratorResponse: "accepted",
            serviceStatus: "planning",
          },
          $push: {
            statusTimeline: {
              status: "planning",
              updatedAt: new Date(),
              updatedBy: email,
            },
          },
        }
      );

      await decoratorsCollection.updateOne(
        { email },
        { $set: { workStatus: "busy" } }
      );

      res.send({ success: true });
    });

    app.patch("/bookings/:id/reject", verifyFBToken, async (req, res) => {
      const bookingId = req.params.id;
      const email = req.decoded_email;

      const booking = await bookingCollection.findOne({
        _id: new ObjectId(bookingId),
        decoratorEmail: email,
        decoratorResponse: "pending",
        serviceStatus: "assigned",
      });

      if (!booking) {
        return res.status(400).send({ message: "Invalid request" });
      }

      await bookingCollection.updateOne(
        { _id: booking._id },
        {
          $set: {
            decoratorResponse: "rejected",
            serviceStatus: "pending",
            decoratorId: null,
            decoratorEmail: null,
            decoratorName: null,
          },
          $push: {
            statusTimeline: {
              status: "rejected-by-decorator",
              updatedAt: new Date(),
              updatedBy: email,
            },
          },
        }
      );

      await decoratorsCollection.updateOne(
        { email },
        { $set: { workStatus: "available" } }
      );

      res.send({ success: true });
    });
    app.patch("/bookings/:id/status", verifyFBToken, async (req, res) => {
      try {
        const bookingId = req.params.id;
        const { serviceStatus } = req.body;
        const email = req.decoded_email;

        const validStatuses = [
          "planning",
          "materials-prepared",
          "on-the-way",
          "setup-in-progress",
          "completed",
        ];

        if (!validStatuses.includes(serviceStatus)) {
          return res.status(400).send({ message: "Invalid status" });
        }

        const booking = await bookingCollection.findOne({
          _id: new ObjectId(bookingId),
          decoratorEmail: email,
          decoratorResponse: "accepted",
        });

        if (!booking) {
          return res.status(403).send({ message: "Forbidden" });
        }

        await bookingCollection.updateOne(
          { _id: booking._id },
          {
            $set: { serviceStatus },
            $push: {
              statusTimeline: {
                status: serviceStatus,
                updatedAt: new Date(),
                updatedBy: email,
              },
            },
          }
        );

        res.send({ success: true });
      } catch (error) {
        console.error("Status Update Error:", error);
        res.status(500).send({ message: "Server error" });
      }
    });
    app.patch("/bookings/:id/service-date", async (req, res) => {
      const { id } = req.params;
      const { serviceDate } = req.body;

      if (!serviceDate) {
        return res.status(400).send({ message: "Service date required" });
      }

      const result = await bookingCollection.updateOne(
        { _id: new ObjectId(id) },
        {
          $set: {
            serviceDate,
            updatedAt: new Date(),
          },
        }
      );

      res.send(result);
    });

    app.delete("/bookings/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await bookingCollection.deleteOne(query);

      res.send(result);
    });

    // payment related api
    app.post("/servicePayment-checkout-session", async (req, res) => {
      const paymentInfo = req.body;
      const amount = parseInt(paymentInfo.price) * 100;
      const session = await stripe.checkout.sessions.create({
        line_items: [
          {
            price_data: {
              currency: "usd",
              product_data: {
                name: paymentInfo.serviceName,
              },
              unit_amount: amount,
            },
            quantity: 1,
          },
        ],
        mode: "payment",
        metadata: {
          bookingId: paymentInfo.bookingId,
          serviceName: paymentInfo.serviceName,
        },

        customer_email: paymentInfo.userEmail,
        success_url: `${process.env.SITE_DOMAIN}/dashboard/payment-success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${process.env.SITE_DOMAIN}/dashboard/payment-cancelled`,
      });
      // console.log(session);

      res.send({ url: session.url });
    });

    app.patch("/payment-success", async (req, res) => {
      try {
        const sessionId = req.query.session_id;
        const session = await stripe.checkout.sessions.retrieve(sessionId);

        const transactionId = session.payment_intent;
        const trackingId = generateTrackingId();

        const existingPayment = await paymentCollection.findOne({
          transactionId,
        });

        if (existingPayment) {
          return res.send({
            message: "payment already done",
            transactionId,
            trackingId: existingPayment.trackingId,
          });
        }

        if (session.payment_status !== "paid") {
          return res.send({ success: false });
        }

        const bookingId = session.metadata.bookingId;

        const updateResult = await bookingCollection.updateOne(
          { _id: new ObjectId(bookingId) },
          {
            $set: {
              paymentStatus: "paid",
              serviceStatus: "pending",
              trackingId,
            },
          }
        );

        const payment = {
          amount: session.amount_total / 100,
          currency: session.currency,
          customerEmail: session.customer_email,
          bookingId,
          serviceName: session.metadata.serviceName,
          transactionId,
          paymentStatus: session.payment_status,
          paidAt: new Date(),
          trackingId,
        };

        const paymentResult = await paymentCollection.insertOne(payment);

        return res.send({
          success: true,
          modifyParcel: updateResult,
          trackingId,
          transactionId,
          paymentInfo: paymentResult,
        });
      } catch (error) {
        console.error(error);
        return res.status(500).send({ success: false, error: "Server error" });
      }
    });

    app.get("/payments", verifyFBToken, async (req, res) => {
      const email = req.query.email;

      const query = {};
      if (email) {
        query.customerEmail = email;
      }

      if (email !== req.decoded_email) {
        return res.status(403).send({ message: "forbidden access" });
      }
      const cursor = paymentCollection.find(query).sort({ paidAt: -1 });
      const result = await cursor.toArray();
      res.send(result);
    });

    app.get("/decorators", async (req, res) => {
      const { status, workStatus, district } = req.query;

      const query = {};

      if (status) {
        query.status = status;
      }

      if (district) {
        query.district = district;
      }

      const decorators = await decoratorsCollection.find(query).toArray();

      res.send(decorators);
    });
    app.get("/available-decorators", async (req, res) => {
      const { date, district } = req.query;

      try {
        const bookingsOnDate = await bookingCollection
          .find(
            {
              serviceDate: date,
              decoratorEmail: { $ne: null },
              serviceStatus: { $ne: "completed" },
            },
            { projection: { decoratorEmail: 1 } }
          )
          .toArray();

        const bookedEmails = bookingsOnDate.map((b) => b.decoratorEmail);

        const query = {
          status: "approved",
          email: { $nin: bookedEmails },
        };

        if (district && district !== "undefined") {
          query.district = district;
        }

        const decorators = await decoratorsCollection.find(query).toArray();

        res.send(decorators);
      } catch (error) {
        res.status(500).send({ message: "Internal Server Error" });
      }
    });

    app.post("/decorators", async (req, res) => {
      const decorator = req.body;
      decorator.status = "pending";
      decorator.createdAt = new Date();
      const result = await decoratorsCollection.insertOne(decorator);
      res.send(result);
    });
    app.patch(
      "/decorators/:id",
      verifyFBToken,
      verifyAdmin,
      async (req, res) => {
        const status = req.body.status;
        const id = req.params.id;
        const query = { _id: new ObjectId(id) };
        const updatedDoc = {
          $set: {
            status: status,
            workStatus: "available",
          },
        };
        const result = await decoratorsCollection.updateOne(query, updatedDoc);

        if (status === "approved") {
          const email = req.body.email;
          const userQuery = { email };
          const updateUser = {
            $set: {
              role: "decorator",
            },
          };
          const result = await userCollection.updateOne(userQuery, updateUser);
        }
        res.send(result);
      }
    );

    app.delete("/decorators/:id", async (req, res) => {
      const id = req.query.id;
      const query = { _id: new ObjectId(id) };
      const result = await decoratorsCollection.deleteOne(query);
      res.send(result);
    });

    async function autoReleaseDecorators() {
      const today = new Date().toISOString().split("T")[0];

      const completedBookings = await bookingCollection
        .find({
          serviceDate: { $lt: today },
          serviceStatus: { $ne: "completed" },
          decoratorEmail: { $ne: null },
        })
        .toArray();

      for (const booking of completedBookings) {
        await bookingCollection.updateOne(
          { _id: booking._id },
          { $set: { serviceStatus: "completed" } }
        );

        await decoratorsCollection.updateOne(
          { email: booking.decoratorEmail },
          { $set: { workStatus: "available" } }
        );
      }
    }
    setInterval(autoReleaseDecorators, 1000 * 60 * 60);
  } finally {
  }
}
run().catch(console.dir);

app.get("/", (req, res) => {
  res.send("style decor project is running");
});

app.listen(port, () => {
  console.log(`Example app listening on port ${port}`);
});
