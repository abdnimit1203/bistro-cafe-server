const express = require("express");
const cors = require("cors");
var jwt = require("jsonwebtoken");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
require("dotenv").config();
const app = express();
const port = process.env.PORT || 3000;
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY)

// middleware

app.use(cors());
app.use(express.json());

// mongoDb

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASSWORD}@cluster0.di78vms.mongodb.net/?retryWrites=true&w=majority`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  try {
    // Connect the client to the server	(optional starting in v4.7)
    // await client.connect();
    // Send a ping to confirm a successful connection

    const menuCollection = client.db("bistroDb").collection("menu");
    const reviewsCollection = client.db("bistroDb").collection("reviews");
    const cartsCollection = client.db("bistroDb").collection("carts");
    const usersCollection = client.db("bistroDb").collection("users");
    const paymentsCollection = client.db("bistroDb").collection("payments");

    //-----------------------------------------
    // jwt related api
    //-----------------------------------------
    app.post("/jwt", async (req, res) => {
      const user = req.body;
      const token = jwt.sign(user, process.env.ACCESS_TOKEN_SECRET, {
        expiresIn: "1h",
      });
      res.send({ token }); // as an object
    });

    // middelwares
    const verifyToken = (req, res, next) => {
      console.log("inside verify token :", req.headers.authorization);
      if (!req.headers.authorization) {
        return res.status(401).send({ message: "Unauthorized access" });
      }
      const token = req.headers.authorization.split(" ")[1];
      jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, (err, decoded) => {
        if (err) {
          return res
            .status(401)
            .send({ message: "unverified: Unauthorized Access" });
        }
        req.decoded = decoded;
        next();
      });
    };
    // use verify admin after verifyToken
    const verifyAdmin = async (req, res, next) => {
      const email = req.decoded.email;
      const query = { email: email };
      const user = await usersCollection.findOne(query);
      const isAdmin = user?.role === "admin";
      if (!isAdmin) {
        return res.status(403).send({ message: "Forbidden access" });
      }
      next();
    };
    //menu reviews related data
    app.get("/menu", async (req, res) => {
      const result = await menuCollection.find().toArray();
      res.send(result);
    });
    app.get("/menu/:id", async (req, res) => {
      const id = req.params.id
      const query = {_id: new ObjectId(id)}
      const result = await menuCollection.findOne(query)
      res.send(result);
    });
    app.post("/menu", verifyToken, verifyAdmin, async (req, res) => {
      const item = req.body;
      const result = await menuCollection.insertOne(item);
      res.send(result);
    });
    app.patch("/menu/:id", verifyToken, verifyAdmin, async (req, res) => {
      const item = req.body;
      const id = req.params.id
      const filter = {_id: new ObjectId(id)}
      const updateDoc  ={

          $set: {
            name: item.name,
            category: item.category,
            price: item.price,
            recipe: item.recipe,
            image: item.image
          }
      }
      const result = await menuCollection.updateOne(filter,updateDoc);
      res.send(result);
    });
    app.delete("/menu/:id", verifyToken, verifyAdmin, async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await menuCollection.deleteOne(query);
      res.send(result);
    });

    app.get("/reviews", async (req, res) => {
      const result = await reviewsCollection.find().toArray();
      res.send(result);
    });
    //carts
    app.get("/carts", async (req, res) => {
      const email = req.query.email;
      let query = {};
      if (email) {
        query = { email: email };
      }
      const result = await cartsCollection.find(query).toArray();
      res.send(result);
    });
    app.post("/carts", async (req, res) => {
      const cartItem = req.body;
      const result = await cartsCollection.insertOne(cartItem);
      res.send(result);
    });

    //delete from cart
    app.delete("/carts/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await cartsCollection.deleteOne(query);
      res.send(result);
    });

    // users related api
    app.get("/users", verifyToken, verifyAdmin, async (req, res) => {
      const result = await usersCollection.find().toArray();
      res.send(result);
    });

    // admin get
    app.get("/users/admin/:email", verifyToken, async (req, res) => {
      const email = req.params.email;
      if (email !== req.decoded.email) {
        return res.status(403).send({ message: "Forbidded access" });
      }
      const query = { email: email };
      const user = await usersCollection.findOne(query);
      let admin = false;
      if (user) {
        admin = user.role === "admin";
      }
      res.send({ admin });
    });

    app.post("/users", async (req, res) => {
      const user = req.body;
      // insert email if doesnt exist
      const query = { email: user.email };
      const existingUser = await usersCollection.findOne(query);
      if (existingUser) {
        return res.send({ message: "user already exist", insertedId: null });
      }
      const result = await usersCollection.insertOne(user);
      res.send(result);
    });

    app.patch(
      "/users/admin/:id",
      verifyToken,
      verifyAdmin,
      async (req, res) => {
        const id = req.params.id;
        const filter = { _id: new ObjectId(id) };
        const updatedDoc = {
          $set: {
            role: "admin",
          },
        };
        const result = await usersCollection.updateOne(filter, updatedDoc);
        res.send(result);
      }
    );

    app.delete("/users/:id", verifyToken, verifyAdmin, async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await usersCollection.deleteOne(query);
      res.send(result);
    });

//payment stripe
    app.post('/create-payment-intent', async(req,res)=>{
      const {price} = req.body
      const amount = parseInt(price*100)

      const paymentIntent = await stripe.paymentIntents.create({
        amount: amount,
        currency: 'usd',
        payment_method_types: ['card']
      })

      res.send({
        clientSecret: paymentIntent.client_secret
      })

    })
// payment related api
app.post('/payments', async(req,res)=>{
  const payment =req.body
  const paymentResult = await paymentsCollection.insertOne(payment)

  //carefully delete each item from the cart of user
  // console.log("Payment Info: ", payment);
  const query = {_id: {
    $in : payment.cartId.map(id=> new ObjectId(id))
  }}
  const deleteResult = await cartsCollection.deleteMany(query)

  res.send({paymentResult,deleteResult})
})
//get all payments by email
app.get("/payments", async (req,res)=>{
  const email = req.query.email
      let query = {};
      if (email) {
        query = { email: email };
      }
  const result = await paymentsCollection.find(query).toArray()
  res.send(result);
})

// --------Stats or analytycs--------------------

app.get('/admin-stats',async(req,res)=>{
  const userCount = await usersCollection.estimatedDocumentCount();
  const menuCount = await menuCollection.estimatedDocumentCount();
  const orderCount = await paymentsCollection.estimatedDocumentCount()

  // normal way revenue generator: 001

  // const payments = await paymentsCollection.find().toArray()
  // const revenue = payments.reduce((total,payment)=>total+payment.amount,0)

  // formal way 
  const result = await paymentsCollection.aggregate([
    {
      $group:{
        _id: null,
        totalRevenue:{
          $sum:'$amount'
        }
      }
    }
  ]).toArray()
  const revenue = result.length>0? result[0].totalRevenue: 0;

  res.send({
    userCount,
    menuCount,
    orderCount,
    revenue
  })
})


//ussing aggregate pipeline
app.get('/order-stat',async(req,res)=>{
  const result = await paymentsCollection.aggregate([
    {$unwind: '$menuItemId'},
    {
      $lookup:{
        from: "menu",
        localField: "menuItemId",
        foreignField: "_id",
        as: 'menuItems'
      }
    }
    
    // {
    //   $unwind:'$menuItems'
    // },
    // {
    //   $group: {
    //     _id: '$menuItems.category',
    //     quantity: {
    //       $sum: 1
    //     }
    //   }
    // }
  ]).toArray()
  res.send(result)
})

// category count
app.get('/category-count', async (req, res) => {

    
    // Aggregate to get category counts
    const result = await menuCollection.aggregate([
      {
        $group: {
          _id: '$category',
          count: { $sum: 1 }
        }
      },
      {
        $project: {
          _id: 0,
          category: '$_id',
          count: 1
        }
      }
    ]).toArray();

    res.send(result)})

//------------------ERROR CRASH HANDLING (Basic)-------------------------
// app.all('*',(req,res,next)=>{
//   const error = new Error(`The requested url is invalid : [${req.originalUrl}]`)
//   error.status=404
//   next(error)
// })
// app.use((err,req,res,next)=>{
//   res.status(err.status || 500).json({
//     message:err.message
//   })
// })

//-------------------------------------------



//send a ping
    // await client.db("admin").command({ ping: 1 });
    // console.log(
    //   "Pinged your deployment. You successfully connected to MongoDB!"
    // );
  } finally {
    // Ensures that the client will close when you finish/error
    // await client.close();
  }
}
run().catch(console.dir);

app.get("/", (req, res) => {
  res.send("My restaurant information coming soon... Has come");
});





app.listen(port, () => {
  console.log(`My restaurant server running on port: ${port}`);
});
