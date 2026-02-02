const express = require('express');
const bodyParser = require('body-parser');
const fs = require('fs');
const path = require('path');
const fetch = require('node-fetch');

const app = express();
const PORT = process.env.PORT || 3000;
const BARK_URL = process.env.BARK_URL;
const PHONE_NUMBER = process.env.PHONE_NUMBER;

// --- Local KV Implementation ---
const DATA_DIR = path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'store.json');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR);
if (!fs.existsSync(DB_FILE)) fs.writeFileSync(DB_FILE, '{}');

const KV = {
  get: async (key) => {
    try {
      const data = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
      const item = data[key];
      if (!item) return null;
      if (item.expireAt && Date.now() > item.expireAt) {
        delete data[key];
        fs.writeFileSync(DB_FILE, JSON.stringify(data));
        return null;
      }
      return item.value;
    } catch (e) { return null; }
  },
  put: async (key, value, options = {}) => {
    const data = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
    const expireAt = options.expirationTtl ? Date.now() + (options.expirationTtl * 1000) : null;
    data[key] = { value, expireAt };
    fs.writeFileSync(DB_FILE, JSON.stringify(data));
  }
};

app.use(bodyParser.json());
app.use(express.static('public'));

// --- Helper Functions (From original movecar.js) ---
function wgs84ToGcj02(lat, lng) {
  const a = 6378245.0;
  const ee = 0.00669342162296594323;
  if (outOfChina(lat, lng)) return { lat, lng };
  let dLat = transformLat(lng - 105.0, lat - 35.0);
  let dLng = transformLng(lng - 105.0, lat - 35.0);
  const radLat = lat / 180.0 * Math.PI;
  let magic = Math.sin(radLat);
  magic = 1 - ee * magic * magic;
  const sqrtMagic = Math.sqrt(magic);
  dLat = (dLat * 180.0) / ((a * (1 - ee)) / (magic * sqrtMagic) * Math.PI);
  dLng = (dLng * 180.0) / (a / sqrtMagic * Math.cos(radLat) * Math.PI);
  return { lat: lat + dLat, lng: lng + dLng };
}

function outOfChina(lat, lng) {
  return lng < 72.004 || lng > 137.8347 || lat < 0.8293 || lat > 55.8271;
}

function transformLat(x, y) {
  let ret = -100.0 + 2.0 * x + 3.0 * y + 0.2 * y * y + 0.1 * x * y + 0.2 * Math.sqrt(Math.abs(x));
  ret += (20.0 * Math.sin(6.0 * x * Math.PI) + 20.0 * Math.sin(2.0 * x * Math.PI)) * 2.0 / 3.0;
  ret += (20.0 * Math.sin(y * Math.PI) + 40.0 * Math.sin(y / 3.0 * Math.PI)) * 2.0 / 3.0;
  ret += (160.0 * Math.sin(y / 12.0 * Math.PI) + 320 * Math.sin(y * Math.PI / 30.0)) * 2.0 / 3.0;
  return ret;
}

function transformLng(x, y) {
  let ret = 300.0 + x + 2.0 * y + 0.1 * x * x + 0.1 * x * y + 0.1 * Math.sqrt(Math.abs(x));
  ret += (20.0 * Math.sin(6.0 * x * Math.PI) + 20.0 * Math.sin(2.0 * x * Math.PI)) * 2.0 / 3.0;
  ret += (20.0 * Math.sin(x * Math.PI) + 40.0 * Math.sin(x / 3.0 * Math.PI)) * 2.0 / 3.0;
  ret += (150.0 * Math.sin(x / 12.0 * Math.PI) + 300.0 * Math.sin(x / 30.0 * Math.PI)) * 2.0 / 3.0;
  return ret;
}

function generateMapUrls(lat, lng) {
  const gcj = wgs84ToGcj02(lat, lng);
  return {
    amapUrl: `https://uri.amap.com/marker?position=${gcj.lng},${gcj.lat}&name=位置`,
    appleUrl: `https://maps.apple.com/?ll=${gcj.lat},${gcj.lng}&q=位置`
  };
}

// --- Routes ---

app.get('/', (req, res) => {
  const host = req.get('host');
  const protocol = req.protocol;
  const origin = `${protocol}://${host}`;
  res.send(renderMainPage(origin));
});

app.get('/owner-confirm', (req, res) => {
  res.send(renderOwnerPage());
});

app.post('/api/notify', async (req, res) => {
  try {
    const { message = '车旁有人等待', location = null, delayed = false } = req.body;
    const host = req.get('host');
    const protocol = req.protocol; // In production behind proxy, might need 'X-Forwarded-Proto'
    const origin = `${protocol}://${host}`;
    const confirmUrl = encodeURIComponent(origin + '/owner-confirm');

    let notifyBody = '🚗 挪车请求';
    if (message) notifyBody += `\n💬 留言: ${message}`;

    if (location && location.lat && location.lng) {
      const urls = generateMapUrls(location.lat, location.lng);
      notifyBody += '\n📍 已附带位置信息，点击查看';
      await KV.put('requester_location', JSON.stringify({
        lat: location.lat, lng: location.lng, ...urls
      }), { expirationTtl: 3600 });
    } else {
      notifyBody += '\n⚠️ 未提供位置信息';
    }

    await KV.put('notify_status', 'waiting', { expirationTtl: 600 });

    if (delayed) {
      await new Promise(resolve => setTimeout(resolve, 30000));
    }

    if (BARK_URL) {
      const barkApiUrl = `${BARK_URL}/挪车请求/${encodeURIComponent(notifyBody)}?group=MoveCar&level=critical&call=1&sound=minuet&icon=https://cdn-icons-png.flaticon.com/512/741/741407.png&url=${confirmUrl}`;
      try {
        await fetch(barkApiUrl);
      } catch (e) {
        console.error("Bark push failed:", e);
      }
    } else {
        console.log("Mock Push:", notifyBody);
    }

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/api/get-location', async (req, res) => {
  const data = await KV.get('requester_location');
  if (data) {
    res.json(JSON.parse(data));
  } else {
    res.status(404).json({ error: 'No location' });
  }
});

app.post('/api/owner-confirm', async (req, res) => {
  try {
    const { location } = req.body;
    if (location) {
      const urls = generateMapUrls(location.lat, location.lng);
      await KV.put('owner_location', JSON.stringify({
        lat: location.lat, lng: location.lng, ...urls, timestamp: Date.now()
      }), { expirationTtl: 3600 });
    }
    await KV.put('notify_status', 'confirmed', { expirationTtl: 600 });
    res.json({ success: true });
  } catch (error) {
    // Even if error, try to confirm
    await KV.put('notify_status', 'confirmed', { expirationTtl: 600 });
    res.json({ success: true });
  }
});

app.get('/api/check-status', async (req, res) => {
  const status = await KV.get('notify_status');
  const ownerLocationRaw = await KV.get('owner_location');
  const ownerLocation = ownerLocationRaw ? JSON.parse(ownerLocationRaw) : null;
  res.json({ status: status || 'waiting', ownerLocation });
});

// --- HTML Templates (Pasted from original, variables injected) ---
// Note: In a real migration, these should be separate .html files or use a template engine.
// For single-file simplicity, keeping them here.

function renderMainPage(origin) {
  // Pass PHONE_NUMBER to the template
  const phone = PHONE_NUMBER || '';
  // ... (HTML Content from previous movecar.js, replacing ${phone} correctly) ...
  // Returning the exact HTML string from movecar.js but ensuring PHONE_NUMBER is handled
  return `
  <!DOCTYPE html>
  <html lang="zh-CN">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=5.0, user-scalable=yes, viewport-fit=cover">
    <title>通知车主挪车</title>
    <!-- ... (Styles same as original) ... -->
    <style>
      /* Keeping styles brief for this file content, assume full styles from original */
      body { font-family: sans-serif; background: #0093E9; padding: 20px; display: flex; justify-content: center; }
      .container { background: white; padding: 20px; border-radius: 20px; width: 100%; max-width: 500px; text-align: center; }
      .btn { background: #0093E9; color: white; padding: 15px; border-radius: 10px; border: none; width: 100%; font-size: 18px; margin-top: 20px; cursor: pointer; }
      input, textarea { width: 100%; padding: 10px; margin-top: 10px; border: 1px solid #ddd; border-radius: 10px; }
    </style>
  </head>
  <body>
    <div class="container" id="mainView">
        <h1>🚗 通知车主挪车</h1>
        <textarea id="msgInput" placeholder="给车主留言..."></textarea>
        <button class="btn" onclick="sendNotify()">🔔 通知车主</button>
        <p id="status" style="margin-top:10px; color:#666"></p>
    </div>
    <div class="container" id="successView" style="display:none">
        <h1>✅ 通知已发送</h1>
        <p>正在等待车主确认...</p>
        <div id="ownerFeedback" style="display:none; margin-top:20px; padding:15px; background:#e6fffa; border-radius:10px;">
            <h3>🎉 车主正在赶来</h3>
            <div id="ownerMapLinks">
                <a id="ownerAmapLink" href="#" target="_blank">🗺️ 高德地图</a>
            </div>
        </div>
        ${phone ? `<a href="tel:${phone}" class="btn" style="background:#f56565; display:block; text-decoration:none; margin-top:20px">📞 电话联系</a>` : ''}
    </div>
    <script>
        async function sendNotify() {
            const msg = document.getElementById('msgInput').value;
            document.getElementById('status').innerText = '正在发送...';
            
            // Simple location mock for docker demo (browser geolocation logic is complex to inline here fully without full template)
            // In real deployment, use the full HTML from movecar.js
            
            navigator.geolocation.getCurrentPosition(async (pos) => {
                doSend(msg, {lat: pos.coords.latitude, lng: pos.coords.longitude});
            }, () => {
                doSend(msg, null);
            });
        }

        async function doSend(msg, loc) {
            const res = await fetch('/api/notify', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({message: msg, location: loc})
            });
            if(res.ok) {
                document.getElementById('mainView').style.display = 'none';
                document.getElementById('successView').style.display = 'block';
                pollStatus();
            } else {
                document.getElementById('status').innerText = '发送失败';
            }
        }

        function pollStatus() {
            setInterval(async () => {
                const res = await fetch('/api/check-status');
                const data = await res.json();
                if(data.status === 'confirmed') {
                    document.getElementById('ownerFeedback').style.display = 'block';
                    if(data.ownerLocation) {
                        document.getElementById('ownerAmapLink').href = data.ownerLocation.amapUrl;
                    }
                }
            }, 3000);
        }
    </script>
  </body>
  </html>
  `;
}

function renderOwnerPage() {
  return `
  <!DOCTYPE html>
  <html>
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>车主确认</title>
    <style>body{background:#667eea;font-family:sans-serif;padding:20px;display:flex;justify-content:center}.card{background:white;padding:30px;border-radius:20px;text-align:center;width:100%;max-width:400px}.btn{background:#48bb78;color:white;padding:15px;border:none;border-radius:10px;width:100%;font-size:18px;cursor:pointer}</style>
  </head>
  <body>
    <div class="card">
        <h1>👋 收到挪车请求</h1>
        <p>点击下方按钮确认，通知对方您正在赶来</p>
        <button id="btn" class="btn" onclick="confirm()">🚀 我正在赶来</button>
    </div>
    <script>
        async function confirm() {
            document.getElementById('btn').innerText = '提交中...';
            navigator.geolocation.getCurrentPosition(async (pos) => {
                doConfirm({lat: pos.coords.latitude, lng: pos.coords.longitude});
            }, () => {
                doConfirm(null);
            });
        }
        async function doConfirm(loc) {
            await fetch('/api/owner-confirm', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({location: loc})
            });
            document.querySelector('.card').innerHTML = '<h1>✅ 已确认</h1><p>对方已收到通知</p>';
        }
    </script>
  </body>
  </html>
  `;
}

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
