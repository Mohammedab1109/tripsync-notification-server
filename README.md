# TripSync Custom Notification Server

## 🎯 What This Is

A simple HTTP server that handles push notifications for your TripSync app **without using Google Cloud Functions** or paid services.

## ✅ Benefits

- **Free to host** on platforms like Railway, Render, or Heroku
- **No Google Cloud costs**
- **Simple HTTP endpoints**
- **Works with your existing Firestore setup**
- **Easy to customize and extend**

## 🚀 Quick Setup

### 1. Install Dependencies

```bash
cd notification_server
npm install
```

### 2. Create Environment File

```bash
cp .env.example .env
```

### 3. Run Locally

```bash
npm run dev
```

The server will run on `http://localhost:3000`

## 📡 API Endpoints

### Register Device
```http
POST /register-device
Content-Type: application/json

{
  "userId": "user123",
  "deviceId": "device456", 
  "platform": "android"
}
```

### Send Notification
```http
POST /send-notification
Content-Type: application/json

{
  "userId": "user123",
  "title": "New Message",
  "body": "John sent you a message",
  "data": {
    "type": "chat",
    "chatId": "chat123"
  }
}
```

### Send to Multiple Users
```http
POST /send-bulk-notification
Content-Type: application/json

{
  "userIds": ["user1", "user2", "user3"],
  "title": "Event Update",
  "body": "Beach trip has been updated",
  "data": {
    "type": "event",
    "eventId": "event123"
  }
}
```

## 🌐 Deploy to Cloud (Free)

### Option 1: Railway (Recommended)
1. Go to [railway.app](https://railway.app)
2. Connect your GitHub repo
3. Deploy the `notification_server` folder
4. Railway will auto-detect Node.js and deploy

### Option 2: Render
1. Go to [render.com](https://render.com)
2. Create new Web Service
3. Connect repo and select `notification_server` folder
4. Deploy with default Node.js settings

### Option 3: Heroku
1. Install Heroku CLI
2. `heroku create your-app-name`
3. `git subtree push --prefix notification_server heroku main`

## 🔧 Integration with Flutter App

The server is designed to work with your existing TripSync app. You'll need to:

1. **Update the notification service** to call your server instead of FCM
2. **Keep Firestore notifications** for in-app display
3. **Add HTTP calls** to your server when sending notifications

## 📱 How It Works

1. **App starts** → Register device with server
2. **User action** (comment, like, etc.) → Send HTTP request to server
3. **Server** → Stores notification and sends to user's devices
4. **Firestore** → Still stores notifications for in-app display

## 🔒 Security Notes

- Add API key authentication for production
- Use HTTPS in production
- Add rate limiting to prevent spam
- Validate all input data

## 🎉 Result

You'll have push notifications working **without any Google Cloud costs**! The server can handle thousands of notifications and is completely free to host.
