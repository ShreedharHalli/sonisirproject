const express = require('express');
const mongoose = require('mongoose');
const authRoutes = require('./routes/authRoutes');
const cookieParser = require('cookie-parser');
const bodyParser = require('body-parser')
const { requireAuth, checkUser } = require('./middleware/authMiddleware');
const dotenv = require("dotenv");
const { MongoStore } = require('wwebjs-mongo');
const { Client, RemoteAuth, MessageMedia, Buttons, List } = require('whatsapp-web.js');
const QRCode = require('qrcode');
const User = require('./models/User');
const fileUpload = require("express-fileupload");
const fs = require('fs');
const path = require('path');


dotenv.config();

const app = express();
const PORT = process.env.PORT || 8001

// middleware
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());
app.use(cookieParser());
app.use(bodyParser.json({ limit: '50mb' }));
app.use(bodyParser.urlencoded({ limit: '50mb', extended: true }));
app.use(fileUpload()); // https://sebhastian.com/express-fileupload/
// https://www.npmjs.com/package/express-fileupload

app.set('views', path.join(__dirname, 'views'));
// view engine
app.set('view engine', 'ejs');



// TO STORE WHATSAPP SESSIONS LOCALLY TO SPEED MESSAGE SENDING. DO NOT REMOVE THIS LINE.
const sessionMap = new Map();

let newlyGeneratedQRCode = '';

//database connection
let store;
// console.log(process.env.MONGODB_URL);
mongoose.connect(process.env.MONGODB_URL, { useNewUrlParser: true, useUnifiedTopology: true } ).then(e => {
  console.log('Mongodb is connected');
  store = new MongoStore({ mongoose: mongoose });
})


app.listen(PORT, () => {
  console.log(`App listening on port ${PORT}`);
})




app.get('/', (req, res) => { res.render('login') });
app.get('*', checkUser);
// app.get('/', (req, res) => {res.render('sonisirpage')}); // temporarily
app.get('/customerpage', requireAuth, (req, res) => res.render('customerpage'));
app.get('/sonisirpage', requireAuth, (req, res) => res.render('sonisirpage'));
app.use(authRoutes)


//cookies
app.get('/set-cookies', (req, res) => {
  res.cookie('newuser', false, { maxAge: 1000 * 60 * 60 * 24, httpOnly: true });
  res.send('you got the cookies')
})

app.get('/generateqrcode', (req, res) => {

  let token = generateRandomString();
  console.log('client is being started ', token);
  try {
    const client = new Client({
      restartOnAuthFail: true,
      puppeteer: {
        headless: true,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-accelerated-2d-canvas',
          '--no-first-run',
          '--no-zygote',
          // '--single-process', // <- this one doesn't works in Windows
          '--disable-gpu'
        ],
      },
      authStrategy: new RemoteAuth({ // check on linux machine for compatibility
        clientId: token,
        store: store,
        backupSyncIntervalMs: 300000
      })
    });

    client.on('remote_session_saved', () => {
      console.log('remote session saved to mongodb');
      let connectedWhatsappNo = client.info.wid.user
      sessionMap.set(token, {
        id: token,
        client: client,
        serverWhatsappNo: connectedWhatsappNo
      });
      const loggedinCustomerObj = res.locals.user;
      insertClientSessionDetailsToCustomerDocument(loggedinCustomerObj, token, connectedWhatsappNo)
    })

    client.initialize();


    client.on('qr', async (qr) => {
      console.log('qr called');
      const generateqrcode = await QRCode.toDataURL(qr);
      // res.status(200).json({ qrCode: generateqrcode, tokenKey: token });
      newlyGeneratedQRCode = generateqrcode;
    })

    client.on('ready', () => {
      console.log(`whatsapp is ready, id is ${token}`);
      newlyGeneratedQRCode = 'stopGeneratingQRCode';
    })
    client.on('authenticated', () => {
      console.log('client is authenticated');
    })
    client.on('disconnected', (reason) => {
      console.log('Client was logged out', reason);
      client.destroy();
    });

    /* 
client.on('change_state', state => {
  console.log('CHANGE STATE', state);
}); */

  } catch (err) {
    res.status(400).json({ error: 'something went wrong, Please contact system administrator' });
  }
})


app.get('/qrcodewithsse', (req, res) => {
  // https://www.youtube.com/watch?v=piEYV-fsYbA
  console.log('Browser has started to listening server side events...');
  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Access-Control-Allow-Origin', '*')

  const intervalId = setInterval(() => {
    const date = new Date().toLocaleString()
    res.write(`data: ${newlyGeneratedQRCode}\n\n`)
    // res.write(newlyGeneratedQRCode)
  }, 2500)


  res.on('close', () => {
    console.log('Browser has stopped to listening server side events...')
    clearInterval(intervalId)
    res.end()
  })
});


// GENERATING RANDOM STRING TO SAVE CLIENT SESSIONS
function generateRandomString() {
  let result = '';
  const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const charactersLength = characters.length;

  for (let i = 0; i < 20; i++) {
    result += characters.charAt(Math.floor(Math.random() * charactersLength));
  }

  return result;
}


function insertClientSessionDetailsToCustomerDocument(custObj, token, connectedWaNo) {
  let loggedinCustomerid = custObj._id.toString();
  let stringedToken = token.toString();
  let stringedconnectedWaNo = connectedWaNo.toString();
  // Find a user by their ID
  User.findById(loggedinCustomerid)
    .then(user => {
      if (!user) {
        // Handle case where user is not found
        console.log('Customer Document Not Found In MongoDB');
        return;
      }
      // Push the new object into the connectedWhatsAppDevices array
      let deviceObj = { token: stringedToken, connectedWano: stringedconnectedWaNo }
      user.connectedWhatsAppDevices.push(deviceObj);
      // https://www.mongodb.com/docs/manual/tutorial/query-arrays/#query-an-array
      // Save the updated user
      return user.save();
    })
    .then(updatedUser => {
      if (updatedUser) {
        console.log('Object pushed into connectedWhatsAppDevices array:', updatedUser);
      }
    })
    .catch(error => {
      console.error(error);
    });
}


app.post('/api/sendmessage', async (req, res) => {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  let customerId = req.body.customerid;
  let whatsappClientId = req.body.serverWhatsappno;
  let mobileNo = req.body.mobileno;
  let mobNoAsUID =  formattedwaNo(mobileNo);
  let message = req.body.message;
  let messageType = req.body.type;
  // let fileToSend = req.files.filetosend; // library express-fileupload
  // let fileName = req.files.filename;
  
  try {
    User.findById(customerId)
      .then(async (user) => {
        if (!user) {
          // Handle case where user is not found
          res.status(404).json({
            status: false,
            response: "Customer Not Found"
          });
        } else {
          if (user.AvailableCredits > 0) {
            for (const device of user.connectedWhatsAppDevices) {
              if (device.connectedWano === whatsappClientId) {
                token = device.token;
                const session = sessionMap.get(token);
                if (session) {
                  if (messageType === 'text') { // SEND ONLY TEXT MESSAGES
                    console.log('i m called');
                    const client = session.client;
                  await client.sendMessage(mobNoAsUID, message).then(async (response) => {
                    user.AvailableCredits--;
                    await User.updateOne({ _id: user._id }, { $set: { AvailableCredits: user.AvailableCredits } });
                    res.write(JSON.stringify({
                      status: true,
                      response: response
                    }));
                  }).catch(err => {
                    console.log(err);
                    res.write(JSON.stringify({
                      status: false,
                      response: err
                    }));
                  });
                  } else if (messageType === 'file') {  // SEND ONLY TEXT MESSAGES
                    let mimeType = req.body.mime;
                    let buffer = req.files.foo.data;
                    const media = new MessageMedia(mimeType, buffer);
                    const client = session.client;
                  await client.sendMessage(mobNoAsUID, media, {caption: message}).then(async (response) => {
                    user.AvailableCredits--;
                    await User.updateOne({ _id: user._id }, { $set: { AvailableCredits: user.AvailableCredits } });
                    res.write(JSON.stringify({
                      status: true,
                      response: response
                    }));
                  }).catch(err => {
                    console.log(err);
                    res.write(JSON.stringify({
                      status: false,
                      response: err
                    }));
                  });
                  }
                } else {
                  const client = new Client({
                    restartOnAuthFail: true,
                    puppeteer: {
                      headless: true,
                      args: [
                        '--no-sandbox',
                        '--disable-setuid-sandbox',
                        '--disable-dev-shm-usage',
                        '--disable-accelerated-2d-canvas',
                        '--no-first-run',
                        '--no-zygote',
                        // '--single-process', // <- this one doesn't works in Windows
                        '--disable-gpu'
                      ],
                    },
                    authStrategy: new RemoteAuth({ // check on linux machine for compatibility
                      clientId: token,
                      store: store,
                      backupSyncIntervalMs: 300000
                    })
                  });
                  client.initialize();
                  client.on('ready', async () => {
                    console.log(`whatsapp is ready, id is ${token}`);
                    let connectedWhatsappNo = client.info.wid.user;
                    sessionMap.set(token, {
                      id: token,
                      client: client,
                      serverWhatsappNo: connectedWhatsappNo
                    });
                    if (messageType === 'text') { // SEND ONLY TEXT MESSAGES
                      console.log('i m called');
                      const client = session.client;
                    await client.sendMessage(mobNoAsUID, message).then(async (response) => {
                      console.log(response);
                      user.AvailableCredits--;
                      await User.updateOne({ _id: user._id }, { $set: { AvailableCredits: user.AvailableCredits } });
                      res.write(JSON.stringify({
                        status: true,
                        response: response
                      }));
                    }).catch(err => {
                      console.log(err);
                      res.write(JSON.stringify({
                        status: false,
                        response: err
                      }));
                    });
                    } else if (messageType === 'file') {  // SEND ONLY TEXT MESSAGES
                      let mimeType = req.body.mime;
                      let buffer = req.files.foo.data;
                      const media = new MessageMedia(mimeType, buffer);
                      const client = session.client;
                    await client.sendMessage(mobNoAsUID, media, {caption: message}).then(async (response) => {
                      user.AvailableCredits--;
                      await User.updateOne({ _id: user._id }, { $set: { AvailableCredits: user.AvailableCredits } });
                      res.write(JSON.stringify({
                        status: true,
                        response: response
                      }));
                    }).catch(err => {
                      console.log(err);
                      res.write(JSON.stringify({
                        status: false,
                        response: err
                      }));
                    });
                    }
                  })
                }
                break;
              }
            }
          }
          let creditsObj = {
              AvailableCredits: user.AvailableCredits
          }
          res.write(JSON.stringify(creditsObj));
          res.end();
        }
      })
      .catch(error => {
        let errorMessage = error.message;
        if (errorMessage.includes('Cast to ObjectId')) {
          res.status(500).json({
            status: false,
            response: "Customer Not Found."
          });
        }
      });
  } catch (error) {
    console.log(error);
  }
});


function formattedwaNo(mobileNo) {
  try {
    if (mobileNo === undefined) {
      return
    } else {
      let stringed = mobileNo.toString();
  if (stringed.length === 10) {
    let mobNoAsUID = `91${stringed}@c.us`;
    return mobNoAsUID
  }
    }
  } catch (error) {
   console.log(error); 
  }
}

app.post('/deleteWhClientSession', async (req, res) => {
  let clientSessionObj  = req.body;
  let clientSessionId = clientSessionObj.clientSessionID;
  try {
    sessionMap.delete(clientSessionId); // delete session from local storage
    await User.updateOne(
      { connectedWhatsAppDevices: { $elemMatch: { token: clientSessionId } } },
      { $pull: { connectedWhatsAppDevices: { token: clientSessionId } } }
    );
    console.log('Object removed successfully');
  } catch (error) {
    console.error(error);
  }
});

