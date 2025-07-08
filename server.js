const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(helmet());
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// Store for active connections (for real-time notifications)
const activeConnections = new Map();

// Health check endpoint
app.get('/', (req, res) => {
  res.json({ 
    message: 'TripSync Notification Server is running!',
    timestamp: new Date().toISOString(),
    connections: activeConnections.size
  });
});

// Register device for notifications
app.post('/register-device', (req, res) => {
  try {
    const { userId, deviceId, platform } = req.body;
    
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
      active: true
    });

    console.log(`✅ Device registered: ${deviceId} for user ${userId}`);
    
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

    // Get user's devices
    const userDevices = activeConnections.get(userId);
    
    if (!userDevices || userDevices.size === 0) {
      console.log(`⚠️ No active devices for user: ${userId}`);
      return res.json({ 
        success: true, 
        message: 'No active devices found for user',
        sentToDevices: 0
      });
    }

    // Send to all user's devices
    let sentCount = 0;
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
          totalSent++;
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
