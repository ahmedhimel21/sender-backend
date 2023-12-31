const express = require('express');
const app = express();
const cors = require('cors');
const jwt = require('jsonwebtoken');
const twilio = require('twilio');
const bodyParser = require('body-parser');
require('dotenv').config();
const port = process.env.PORT || 5000;

// middleware
app.use(cors());
app.use(express.json());
app.use(bodyParser.json());

// twilio setup
const twilioAccountSid = process.env.TWILIO_SID;
const twilioAuthToken = process.env.TWILIO_AUTH_TOKEN;
const twilioPhoneNumber = '+16066570812';
const twilioClient = twilio(twilioAccountSid, twilioAuthToken);

// verify jwt middleware
const verifyJWT = (req, res, next) => {
  const authorization = req.headers.authorization;
  if (!authorization) {
    return res.status(401).send({ error: true, message: 'unauthorized access' });
  }
  // bearer token
  const token = authorization.split(' ')[1];

  jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, (err, decoded) => {
    if (err) {
      return res.status(401).send({ error: true, message: 'unauthorized access' })
    }
    req.decoded = decoded;
    next();
  })
}

app.get('/', (req, res) => {
  res.send('running')
});

const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.hltgyxi.mongodb.net/?retryWrites=true&w=majority`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  }
});

async function run() {
  try {
    // Connect the client to the server	(optional starting in v4.7)
    // await client.connect();

    const usersCollection = client.db('sender').collection('users');
    const consumerCollection = client.db('sender').collection('consumerCollection');

    // jwt related api
    app.post('/jwt', (req, res) => {
      const user = req.body;
      const token = jwt.sign(user, process.env.ACCESS_TOKEN_SECRET, { expiresIn: '10h' })
      res.send({ token });
    });

    // verify admin middleware
    const verifyAdmin = async (req, res, next) => {
      const email = req.decoded.email;
      const query = { email: email }
      const user = await usersCollection.findOne(query);
      console.log(user)
      if (user?.role !== 'admin') {
        return res.status.send({ error: true, message: 'forbidden' })
      }
      next();
    }

    // users related api
    app.get('/users', verifyJWT, verifyAdmin, async (req, res) => {
      const result = await usersCollection.find().toArray();
      res.send(result)
    });

    app.post('/users', async (req, res) => {
      const user = req.body;
      const query = { email: user.email };
      const existingUser = await usersCollection.findOne(query);
      if (existingUser) {
        return res.send(({ message: 'User already exist' }))
      }
      const result = await usersCollection.insertOne(user);
      res.send(result);
    });

    // user delete api
    app.delete('users/:id', async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) }
      const result = await usersCollection.deleteOne(query);
      res.send(result);
    })

    // post consumer data
    app.post('/consumer', async (req, res) => {
      const data = req.body;
      const result = await consumerCollection.insertOne(data);
      res.send(result);
    })
    // get all consumer data
    app.get('/consumer', async (req, res) => {
      const cursor = consumerCollection.find();
      const result = await cursor.toArray();
      res.send(result)
    })

    // admin update api
    app.patch('/users/admin/:id', async (req, res) => {
      const id = req.params.id;
      const filter = { _id: new ObjectId(id) }
      const updateDoc = {
        $set: { role: 'admin' }
      }
      const result = await usersCollection.updateOne(filter, updateDoc);
      res.send(result);
    })

    // check admin
    app.get('/users/admin/:email', verifyJWT, async (req, res) => {
      const email = req.params.email;
      if (req.decoded.email !== email) {
        res.send({ admin: false })
      }
      const query = { email: email }
      const user = await usersCollection.findOne(query);
      const result = { admin: user?.role === 'admin' }
      res.send(result)
    })

    // consumer update api
    app.patch('/users/consumer/:id', async (req, res) => {
      const id = req.params.id;
      const filter = { _id: new ObjectId(id) }
      const updateDoc = {
        $set: { role: 'consumer' }
      }
      const result = await usersCollection.updateOne(filter, updateDoc);
      res.send(result);
    })

    // check consumer
    app.get('/users/consumer/:email', verifyJWT, async (req, res) => {
      const email = req.params.email;
      if (req.decoded.email !== email) {
        res.send({ consumer: false })
      }
      const query = { email: email }
      const user = await usersCollection.findOne(query);
      const result = { consumer: user?.role === 'consumer' }
      res.send(result)
    })

    // API endpoint for sending SMS
    app.post('/api/send-sms', async (req, res) => {
      const { recipient, message } = req.body;

      try {
        const sentMessage = await twilioClient.messages.create({
          body: message,
          from: twilioPhoneNumber,
          to: recipient,
        });

        res.json({ message: 'SMS sent successfully', messageId: sentMessage.sid });
      } catch (error) {
        console.error('Twilio Error:', error);
        res.status(500).json({ message: 'Failed to send SMS', error: error.message });
      }
    });

    // api for sending consumer sms
    app.post('/api/consumer/send-sms', async (req, res) => {
      const { userId, message, recipient } = req.body;
      console.log(userId, message, recipient)

      try {
        const sentMessage = await twilioClient.messages.create({
          body: message,
          from: twilioPhoneNumber,
          to: recipient,
        });

        const creditsUpdate = await consumerCollection.updateOne(
          { _id: new ObjectId(userId) },
          {
            $inc: {
              smsCredits: +1
            }
          }
        );

        console.log('SMS record inserted:');

        res.json({ message: 'SMS sent successfully', messageId: sentMessage.sid });
      } catch (error) {
        console.error('Twilio Error:', error);
        res.status(500).json({ message: 'Failed to send SMS', error: error.message });
      }
    });

    // remaining sms credits
    app.get('/smsCredits/:id', async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await consumerCollection.findOne(query);
      res.send(result);
    })

    // get all consumer sms credits
    app.get('/consumerCredits', async (req, res) => {
      const cursor = consumerCollection.find();
      const result = await cursor.toArray();
      res.send(result);
    })

    app.patch('/smsCreditGrant/:id', async (req, res) => {
      const id = req.params.id;
      const filter = { _id: new ObjectId(id) }
      const options = {upsert:true};
      const updateDoc = {
        $set: {

          smsCredits: 0
        }
      }
      const result = await consumerCollection.updateOne(filter, updateDoc,options);
      res.send(result)
      console.log(id);
    })

    // Send a ping to confirm a successful connection
    await client.db("admin").command({ ping: 1 });
    console.log("Pinged your deployment. You successfully connected to MongoDB!");
  } finally {
    // Ensures that the client will close when you finish/error
    // await client.close();
  }
}
run().catch(console.dir);


app.listen(port, () => {
  console.log(`sender running on port: ${port}`)
})