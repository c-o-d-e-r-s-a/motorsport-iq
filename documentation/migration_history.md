# 🚀 Migration to Render.com - Setup Guide

## Current Status

- ✅ **Backend**: Node.js 18 + Express + Socket.io (already configured)
- ✅ **Dependencies**: All packages installed in `backend/node_modules`
- ⏳ **Build Scripts**: Configured in `package.json` (`build`: `tsc`, `start`: `node dist/server.js`)
- ⚠️ **Railway URL**: Currently deployed at Railway, needs migration to Render

---

## 📋 Pre-deployment Checklist

### 1. Generate Admin Secret (on Render dashboard)

```bash
# Generate random secret for ADMIN_SESSION_SECRET:
node -e "const crypto = require('crypto'); console.log(crypto.randomBytes(32).toString('hex'))"

# Example output: a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6
```

### 2. Generate Admin Password Hash

```bash
cd backend
node -e "const bcrypt=require('bcrypt'); console.log(bcrypt.hashSync('admin123', 10))"

# Example output: $2b$10$rYqW... (copy this to RENDER env)
```

---

## 🌐 Render.com Deployment Steps

### Step 1: Create Render Account

1. Visit https://render.com/register
2. Sign up with GitHub account (recommended)
3. Verify email address

### Step 2: Connect GitHub Repository

1. Click **"New +"** button in Render dashboard
2. Select **"Web Service"**
3. Click **"Deploy"** and select your GitHub repo (`motorsport-iq`)
4. Set **Root Directory** to `/backend`

### Step 3: Configure Environment Variables

In the Render dashboard, add these environment variables:

```env
SUPABASE_URL=https://rwwdnhclabuqvoxqzrcy.supabase.co
SUPABASE_SERVICE_KEY=<your_actual_service_key_from_render>
GROQ_API_KEY=<your_actual_groq_api_key_from_render>
GROQ_MODEL=llama-3.3-70b-versatile
OPENF1_BASE_URL=https://api.openf1.org/v1
PORT=4000
NODE_ENV=production

# 🔒 SECURITY - Replace with generated values:
ADMIN_SESSION_SECRET=<paste_random_32_char_secret_here>
ADMIN_INITIAL_PASSWORD_HASH=<paste_hash_here>

# 🌐 CORS - Add your frontend URL(s):
CORS_ORIGIN=https://motorsport-iq.vercel.app,http://localhost:3000,https://your-render-url.onrender.com
```

### Step 4: Deploy

Render will automatically:
1. Pull code from GitHub (`main` branch)
2. Run `npm install` in `/backend` directory
3. Run `npm run build` (TypeScript compilation)
4. Start with `node dist/server.js`

### Step 5: Post-Deployment Configuration

After deployment, update these files:

#### A. Update Frontend Backend URL

Edit `frontend/src/lib/backendUrl.ts`:

```typescript
const PRODUCTION_BACKEND_URL = 'https://YOUR-RENDER-URL.onrender.com';
// Replace with your actual Render URL from dashboard
```

#### B. Update Railway Environment (Optional)

If you keep the Railway deployment running, update its CORS origins:

```env
CORS_ORIGIN=<add-your-render-frontend-url-here>,http://localhost:3000
```

---

## 🆚 Render vs Railway Comparison

| Feature | Railway | Render Free Tier |
|---------|---------|------------------|
| **CPU** | 1GB RAM, 512MB dedicated | 512MB shared CPU |
| **Builds** | Unlimited trial | $5/month credit |
| **Spin-down** | None | After 15min inactivity |
| **SSL** | Free HTTPS | Free HTTPS included |
| **Database** | Separate billing ($0.06/hr) | Postgres separate |

### Why This Migration Works

- ✅ App is stateless (all data in Supabase)
- ✅ Users reconnect via `lobby_state` events
- ✅ No real-time session persistence needed
- ✅ Render's spin-down won't affect users

---

## 🔧 Production Settings (Render Dashboard)

After deploying:

1. **Autoscaling**: Enable → Min=1, Max=3 CPUs
2. **HTTPS**: Auto-enabled by Render (free SSL)
3. **Watchdog**: Leave disabled (Express handles restarts automatically)
4. **Timeout Protection**: Not needed for this use case

### Free Tier Limits

- $5/month credit
- ~$0.30/hour of runtime
- Spin-down after 15 minutes of no traffic

**Solution**: Users reconnect on every visit via Supabase + Socket.io reconnection logic (already implemented).

---

## 🆘 Troubleshooting

### Issue: Connection refused / Port not accessible

**Fix**: Ensure Render "Web Service" deployment has `PORT=4000` in environment variables.

### Issue: CORS errors from frontend

**Fix**: Add your Render frontend URL to `backend/.env` or Render environment variable `CORS_ORIGIN`.

### Issue: Build fails

**Fix**: 
1. Check TypeScript compiles: `npm run build`
2. Ensure all dependencies in `/backend/node_modules` are included in Git (they are - check `.gitignore`)

### Issue: Socket.io connection drops

**Fix**: This is expected on Render's spin-down. Users will reconnect via the reconnection logic in `frontend/src/lib/socket.ts`.

---

## 📝 Migration Notes

- **Build Command**: `npm run build` (TypeScript → JS in `dist/`)
- **Start Command**: `node dist/server.js`
- **Root Directory**: `/backend` (not `/`)
- **Branch**: `main` or `master`

---

## ✅ Success Criteria

After deployment:

1. ✅ Visit Render URL in browser → Server responds with health check
2. ✅ Admin panel works at `<render-url>/admin`
3. ✅ Socket.io connections work from frontend (check Network tab)
4. ✅ Frontend can connect to new backend URL

---

## 🔐 Security Checklist

- [ ] `ADMIN_SESSION_SECRET` is 32+ random characters
- [ ] `CORS_ORIGIN` only includes trusted frontend URLs
- [ ] Supabase Row Level Security updated for new origin
- [ ] Groq API key not exposed in client code (currently OK)
- [ ] Production environment (`NODE_ENV=production`)

---

## 📖 Next Steps

1. Create Render account: https://render.com/register
2. Connect GitHub repo `/backend` directory
3. Add environment variables from `.env.render` template
4. Deploy and wait for build completion (~5-10 min)
5. Update `frontend/src/lib/backendUrl.ts` with new Render URL
6. Test full flow: Frontend → Socket.io reconnection
