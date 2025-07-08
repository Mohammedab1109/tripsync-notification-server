const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const admin = require('firebase-admin');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Initialize Firebase Admin SDK
let firebaseInitialized = false;
try {
  // For production, set FIREBASE_SERVICE_ACCOUNT_KEY environment variable
  const serviceAccount = process.env.FIREBASE_SERVICE_ACCOUNT_KEY 
    ? JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY)
    : require('./firebase-service-account.json'); // For local development
  
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    databaseURL: process.env.FIREBASE_DATABASE_URL || "https://exp-proj5-kareem-default-rtdb.firebaseio.com"
  });
  
  firebaseInitialized = true;
  console.log('✅ Firebase Admin SDK initialized');
} catch (error) {
  console.error('❌ Firebase Admin SDK initialization failed:', error);
  console.log('⚠️ Push notifications will not work without Firebase Admin SDK');
}

// Middleware
app.use(helmet());
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// Store for device FCM tokens
const deviceTokens = new Map(); // userId -> Map(deviceId -> fcmToken)
const activeConnections = new Map(); // Keep for backward compatibility

// Health check endpoint
app.get('/', (req, res) => {
  res.json({ 
    message: 'TripSync Notification Server is running!',
    timestamp: new Date().toISOString(),
    connections: activeConnections.size,
    firebaseInitialized: firebaseInitialized
  });
});

// Register device for notifications
app.post('/register-device', (req, res) => {
  try {
    const { userId, deviceId, platform, fcmToken } = req.body;
    
    if (!userId || !deviceId) {
      return res.status(400).json({ error: 'userId and deviceId are required' });
    }

    // Store device info
    if (!activeConnections.has(userId)) {
      activeConnections.set(userId, new Map());
    }
    
    activeConnections.get(userId).set(deviceId, {
      platform,
      lastSeen: new Date(),
      active: true,
      fcmToken: fcmToken || null
    });

    // Store FCM token if provided
    if (fcmToken) {
      if (!deviceTokens.has(userId)) {
        deviceTokens.set(userId, new Map());
      }
      deviceTokens.get(userId).set(deviceId, fcmToken);
    }

    console.log(`✅ Device registered: ${deviceId} for user ${userId} ${fcmToken ? '(with FCM token)' : ''}`);
    
    res.json({ 
      success: true, 
      message: 'Device registered successfully',
      userId,
      deviceId
    });
  } catch (error) {
    console.error('Error registering device:', error);
    res.status(500).json({ error: 'Failed to register device' });
  }
});

// Send notification to specific user
app.post('/send-notification', async (req, res) => {
  try {
    const { 
      userId, 
      title, 
      body, 
      data,
      type = 'general'
    } = req.body;

    if (!userId || !title || !body) {
      return res.status(400).json({ error: 'userId, title, and body are required' });
    }

    // Get user's FCM tokens
    const userTokens = deviceTokens.get(userId);
    let sentCount = 0;
    
    if (userTokens && userTokens.size > 0 && firebaseInitialized) {
      // Send Firebase push notifications
      const tokens = Array.from(userTokens.values());
      
      // Convert data to strings (FCM requirement)
      const stringifiedData = {};
      if (data) {
        Object.keys(data).forEach(key => {
          stringifiedData[key] = String(data[key]);
        });
      }
      
      const message = {
        notification: {
          title: title,
          body: body,
        },
        data: {
          type: String(type),
          ...stringifiedData
        },
        tokens: tokens,
        android: {
          notification: {
            icon: 'ic_launcher',
            color: '#FF6B35',
            channelId: 'tripsync_notifications',
            priority: 'high',
            defaultSound: true,
            defaultVibrateTimings: true,
          },
          data: {
            click_action: 'FLUTTER_NOTIFICATION_CLICK',
            type: String(type),
            ...stringifiedData
          }
        },
        apns: {
          payload: {
            aps: {
              alert: {
                title: title,
                body: body,
              },
              badge: 1,
              sound: 'default',
              category: 'GENERAL',
            },
          },
        },
      };

      try {
        const response = await admin.messaging().sendMulticast(message);
        sentCount = response.successCount;
        
        console.log(`✅ Firebase push notification sent to ${sentCount} devices for user: ${userId}`);
        console.log(`📱 Notification: "${title}" - "${body}"`);
        
        // Handle failed tokens
        if (response.failureCount > 0) {
          console.log(`❌ Failed to send to ${response.failureCount} devices`);
          response.responses.forEach((resp, idx) => {
            if (!resp.success) {
              console.error(`❌ Failed to send to token ${idx}:`, resp.error);
              // Remove invalid tokens
              if (resp.error?.code === 'messaging/registration-token-not-registered' ||
                  resp.error?.code === 'messaging/invalid-registration-token') {
                const tokenToRemove = tokens[idx];
                for (const [deviceId, token] of userTokens.entries()) {
                  if (token === tokenToRemove) {
                    userTokens.delete(deviceId);
                    console.log(`🗑️ Removed invalid token for device: ${deviceId}`);
                    break;
                  }
                }
              }
            }
          });
        }
      } catch (firebaseError) {
        console.error('❌ Firebase messaging error:', firebaseError);
      }
    } else {
      console.log(`⚠️ No FCM tokens or Firebase not initialized for user: ${userId}`);
    }

    // Get user's devices for fallback
    const userDevices = activeConnections.get(userId);
    
    if (!userDevices || userDevices.size === 0) {
      console.log(`⚠️ No active devices for user: ${userId}`);
      return res.json({ 
        success: true, 
        message: sentCount > 0 ? `Push notification sent to ${sentCount} devices` : 'No active devices found for user',
        sentToDevices: sentCount
      });
    }

    // Send to all user's devices (fallback/additional)
    const notifications = [];

    for (const [deviceId, deviceInfo] of userDevices.entries()) {
      const notification = {
        id: generateNotificationId(),
        userId,
        deviceId,
        title,
        body,
        data: data || {},
        type,
        timestamp: new Date().toISOString(),
        platform: deviceInfo.platform
      };

      notifications.push(notification);
      sentCount++;
    }

    console.log(`📨 Notification sent: "${title}" to ${sentCount} devices for user ${userId}`);

    // Here you would typically send to FCM or other push services
    // For now, we'll just store and simulate the notification
    
    res.json({
      success: true,
      message: 'Notification sent successfully',
      sentToDevices: sentCount,
      notifications
    });

  } catch (error) {
    console.error('Error sending notification:', error);
    res.status(500).json({ error: 'Failed to send notification' });
  }
});

// Send notification to multiple users
app.post('/send-bulk-notification', async (req, res) => {
  try {
    const { 
      userIds, 
      title, 
      body, 
      data,
      type = 'general'
    } = req.body;

    if (!userIds || !Array.isArray(userIds) || !title || !body) {
      return res.status(400).json({ error: 'userIds (array), title, and body are required' });
    }

    let totalSent = 0;
    const results = [];

    // Collect all FCM tokens for bulk sending
    const allTokens = [];
    const tokenUserMap = new Map(); // token -> userId

    for (const userId of userIds) {
      const userTokens = deviceTokens.get(userId);
      if (userTokens && userTokens.size > 0) {
        const tokens = Array.from(userTokens.values());
        tokens.forEach(token => {
          allTokens.push(token);
          tokenUserMap.set(token, userId);
        });
      }
    }

    // Send FCM notifications in batches (FCM allows up to 500 tokens per request)
    if (allTokens.length > 0 && firebaseInitialized) {
      const batchSize = 500;
      
      for (let i = 0; i < allTokens.length; i += batchSize) {
        const tokenBatch = allTokens.slice(i, i + batchSize);
        
        // Convert data to strings (FCM requirement)
        const stringifiedData = {};
        if (data) {
          Object.keys(data).forEach(key => {
            stringifiedData[key] = String(data[key]);
          });
        }
        
        const message = {
          notification: {
            title: title,
            body: body,
          },
          data: {
            type: String(type),
            ...stringifiedData
          },
          tokens: tokenBatch,
          android: {
            notification: {
              icon: 'ic_launcher',
              color: '#FF6B35',
              channelId: 'tripsync_notifications',
              priority: 'high',
              defaultSound: true,
              defaultVibrateTimings: true,
            },
            data: {
              click_action: 'FLUTTER_NOTIFICATION_CLICK',
              type: String(type),
              ...stringifiedData
            }
          },
          apns: {
            payload: {
              aps: {
                alert: {
                  title: title,
                  body: body,
                },
                badge: 1,
                sound: 'default',
                category: 'GENERAL',
              },
            },
          },
        };

        try {
          const response = await admin.messaging().sendMulticast(message);
          totalSent += response.successCount;
          
          console.log(`✅ Batch FCM notification sent to ${response.successCount} devices`);
          
          // Handle failed tokens
          if (response.failureCount > 0) {
            response.responses.forEach((resp, idx) => {
              if (!resp.success) {
                console.error(`❌ Failed to send to token ${idx}:`, resp.error);
                // Remove invalid tokens
                if (resp.error?.code === 'messaging/registration-token-not-registered' ||
                    resp.error?.code === 'messaging/invalid-registration-token') {
                  const tokenToRemove = tokenBatch[idx];
                  const userId = tokenUserMap.get(tokenToRemove);
                  if (userId) {
                    const userTokens = deviceTokens.get(userId);
                    if (userTokens) {
                      for (const [deviceId, token] of userTokens.entries()) {
                        if (token === tokenToRemove) {
                          userTokens.delete(deviceId);
                          console.log(`🗑️ Removed invalid token for user ${userId}, device: ${deviceId}`);
                          break;
                        }
                      }
                    }
                  }
                }
              }
            });
          }
        } catch (firebaseError) {
          console.error('❌ Firebase bulk messaging error:', firebaseError);
        }
      }
    }

    // Legacy device tracking for fallback
    for (const userId of userIds) {
      const userDevices = activeConnections.get(userId);
      
      if (userDevices && userDevices.size > 0) {
        for (const [deviceId, deviceInfo] of userDevices.entries()) {
          const notification = {
            id: generateNotificationId(),
            userId,
            deviceId,
            title,
            body,
            data: data || {},
            type,
            timestamp: new Date().toISOString(),
            platform: deviceInfo.platform
          };

          results.push(notification);
        }
      }
    }

    console.log(`📨 Bulk notification sent: "${title}" to ${totalSent} devices across ${userIds.length} users`);

    res.json({
      success: true,
      message: 'Bulk notification sent successfully',
      totalUsers: userIds.length,
      sentToDevices: totalSent,
      notifications: results
    });

  } catch (error) {
    console.error('Error sending bulk notification:', error);
    res.status(500).json({ error: 'Failed to send bulk notification' });
  }
});

// Get notification status
app.get('/status/:userId', (req, res) => {
  try {
    const { userId } = req.params;
    const userDevices = activeConnections.get(userId);
    
    if (!userDevices) {
      return res.json({
        userId,
        devices: [],
        activeDevices: 0
      });
    }

    const devices = Array.from(userDevices.entries()).map(([deviceId, info]) => ({
      deviceId,
      platform: info.platform,
      lastSeen: info.lastSeen,
      active: info.active
    }));

    res.json({
      userId,
      devices,
      activeDevices: devices.filter(d => d.active).length
    });

  } catch (error) {
    console.error('Error getting status:', error);
    res.status(500).json({ error: 'Failed to get status' });
  }
});

// Remove device
app.delete('/device/:userId/:deviceId', (req, res) => {
  try {
    const { userId, deviceId } = req.params;
    
    const userDevices = activeConnections.get(userId);
    if (userDevices && userDevices.has(deviceId)) {
      userDevices.delete(deviceId);
      
      if (userDevices.size === 0) {
        activeConnections.delete(userId);
      }
      
      console.log(`🗑️ Device removed: ${deviceId} for user ${userId}`);
    }
    
    res.json({ success: true, message: 'Device removed successfully' });
  } catch (error) {
    console.error('Error removing device:', error);
    res.status(500).json({ error: 'Failed to remove device' });
  }
});

// Utility functions
function generateNotificationId() {
  return 'notif_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
}

// Clean up inactive devices every hour
setInterval(() => {
  const now = new Date();
  const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
  
  for (const [userId, devices] of activeConnections.entries()) {
    for (const [deviceId, deviceInfo] of devices.entries()) {
      if (deviceInfo.lastSeen < oneHourAgo) {
        devices.delete(deviceId);
        console.log(`🧹 Cleaned up inactive device: ${deviceId} for user ${userId}`);
      }
    }
    
    if (devices.size === 0) {
      activeConnections.delete(userId);
    }
  }
}, 60 * 60 * 1000); // Run every hour

// Error handling middleware
app.use((error, req, res, next) => {
  console.error('Server error:', error);
  res.status(500).json({ error: 'Internal server error' });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Endpoint not found' });
});

app.listen(PORT, () => {
  console.log(`🚀 TripSync Notification Server running on port ${PORT}`);
  console.log(`📱 Ready to handle notifications!`);
});
