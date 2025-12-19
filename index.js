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

    // user related apis

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
      console.log(session);

      res.send({ url: session.url });
    });

    app.patch("/payment-success", async (req, res) => {
      const sessionId = req.query.session_id;
      const session = await stripe.checkout.sessions.retrieve(sessionId);
      console.log("session retrieve", session);
      if (session.payment_status === "paid") {
        const id = session.metadata.bookingId;
        const query = { _id: new ObjectId(id) };
        const trackingId = generateTrackingId()
        const update = {
          $set: {
            paymentStatus: "paid",
            // deliveryStatus: "pending-pickup",
            trackingId:trackingId
          },
        }
        const result = await bookingCollection.updateOne(query, update)
         const payment = {
          amount: session.amount_total / 100,
          currency: session.currency,
          customerEmail: session.customer_email,
          bookingId: session.metadata.bookingId,
          serviceName: session.metadata.serviceName,
          transactionId: session.payment_intent,
          paymentStatus: session.payment_status,
          paidAt: new Date(),
          trackingId: trackingId,
        };

        
        if (session.payment_status === "paid") {
          const resultPayment = await paymentCollection.insertOne(payment);

          // logTracking(trackingId,'pending-pickup')
          res.send({
            success: true,
            modifyParcel: result,
            trackingId: trackingId,
            transactionId: session.payment_intent,
            paymentInfo: resultPayment,
          });
        }
        
      }

      res.send({ success: false });
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
