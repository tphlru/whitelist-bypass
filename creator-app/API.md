# Creator API Documentation

HTTP API for remote control of the Creator application.

## Configuration

API settings are available in the UI via Settings → API settings:

Env variables (for initial startup):
- `CREATOR_API_PORT` - API server port
- `CREATOR_API_KEY` - secret key

## Authorization

If "Require API secret for access" is enabled:

```bash
curl -H "Authorization: Bearer your-secret-key" http://localhost:8080/api/calls
```

## Endpoints

### Health Check

```
GET /api/health
```

**Response:**
```json
{
  "status": "ok",
  "version": "0.1.8"
}
```

**Example:**
```bash
curl http://localhost:8080/api/health
```

---

### List Calls

```
GET /api/calls
```

**Response:**
```json
{
  "calls": [
    {
      "tabId": "api-tab-1234567890",
      "platform": "vk",
      "mode": "dc",
      "relayRunning": true,
      "isBot": false,
      "isApi": false,
      "peerId": null,
      "callLink": "https://vk.com/call/join/abc123",
      "callStatus": "active"
    }
  ]
}
```

**Example:**
```bash
curl http://localhost:8080/api/calls
```

---

### Create New Call

```
POST /api/call/create
```

Automatically loads the call page and clicks the create call button (Please note: the CAPTCHA at this stage may disrupt the operation):

**Request body:**
```json
{
  "platform": "vk",      // "vk" or "telemost"
  "mode": "dc"           // "dc" or "pion-video"
}
```

**Response:**
```json
{
  "tabId": "api-tab-1234567890",
  "url": "https://vk.com/calls",
  "platform": "vk",
  "mode": "dc"
}
```

**Examples:**
```bash
# Create VK call in DC mode
curl -X POST http://localhost:8080/api/call/create \
  -H "Content-Type: application/json" \
  -d '{"platform":"vk","mode":"dc"}'

# Create Telemost call in Video mode
curl -X POST http://localhost:8080/api/call/create \
  -H "Content-Type: application/json" \
  -d '{"platform":"telemost","mode":"pion-video"}'
```

---

### Join Existing Call

```
POST /api/call/join
```

**Request body:**
```json
{
  "url": "https://telemost.yandex.ru/j/184692*****526",  // Call link
  "mode": "dc"
}
```

**Response:**
```json
{
  "tabId": "api-tab-1234567890",
  "url": "https://telemost.yandex.ru/j/184692*****526",
  "platform": "telemost",
  "mode": "dc"
}
```

**Examples:**
```bash
# Join VK call
curl -X POST http://localhost:8080/api/call/join \
  -H "Content-Type: application/json" \
  -d '{"url":"https://vk.com/call/join#xyz789","mode":"dc"}'

# Join Telemost call in Video mode
curl -X POST http://localhost:8080/api/call/join \
  -H "Content-Type: application/json" \
  -d '{"url":"https://telemost.yandex.ru/join#abc123","mode":"pion-video"}'
```

---

### Close Call

```
DELETE /api/call/:tabId
```

**Response:**
```json
{
  "success": true
}
```

**Example:**
```bash
curl -X DELETE http://localhost:8080/api/call/api-tab-1234567890
```

---

### Get Call Logs

```
GET /api/call/:tabId/logs
```

**Response:**
```json
{
  "relayLogs": "2024/04/01 12:00:00 dc-creator: WebSocket on 127.0.0.1:10002\n...",
  "hookLogs": "[HOOK] DataChannel opened\n..."
}
```

**Example:**
```bash
curl http://localhost:8080/api/call/api-tab-1234567890/logs
```

---
