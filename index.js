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

const serviceAccount = require("./style-decor-project-firebase-adminsdk.json");

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
  // console.log(token)
  if (!token) {
    return res.status(401).send({ message: "unauthorized access" });
  }
  try {
    const idToken = token.split(" ")[1];
    const decoded = await admin.auth().verifyIdToken(idToken);
    console.log("after decoded", decoded);
    req.decoded_email = decoded.email;
    next();
  } catch (error) {
    return res.status(401).send({ message: "unauthorized access" });
  }
};

async function run() {
  try {
    await client.connect();
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
    app.get("/users", async (req, res) => {
      const cursor = userCollection.find();
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

    // service related apis
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

    // booking related apis
    app.get("/bookings", async (req, res) => {
      const query = {};

      const { email } = req.query;
      if (email) {
        query.userEmail = email;
      }
      // if (deliveryStatus) {
      //   query.deliveryStatus = deliveryStatus;
      // }
      const options = { sort: { createdAt: -1 } };
      const cursor = bookingCollection.find(query, options);
      const result = await cursor.toArray();
      res.send(result);
    });
    app.post("/bookings", async (req, res) => {
      const booking = req.body;
      // parcel.createdAt = new Date();
      const result = await bookingCollection.insertOne(booking);
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
    // decorators related apis
    app.get("/decorators", async (req, res) => {
      const query = {};
      if (req.query.status) {
        query.status = req.query.status;
      }
      const cursor = decoratorsCollection.find(query);
      const result = await cursor.toArray();
      res.send(result);
    });

    app.post("/decorators", async (req, res) => {
      const decorator = req.body;
      decorator.status = "pending";
      decorator.createdAt = new Date();
      const result = await decoratorsCollection.insertOne(decorator);
      res.send(result);
    });
    app.patch("/decorators/:id", verifyFBToken, async (req, res) => {
      const status = req.body.status;
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const updatedDoc = {
        $set: {
          status: status,
          // workStatus: "available",
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
    });

    app.delete("/decorators/:id", async (req, res) => {
      const id = req.query.id;
      const query = { _id: new ObjectId(id) };
      const result = await decoratorsCollection.deleteOne(query);
      res.send(result);
    });

    await client.db("admin").command({ ping: 1 });
    console.log(
      "Pinged your deployment. You successfully connected to MongoDB!"
    );
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
