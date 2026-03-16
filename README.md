# Food Delivery Platform Suite

Deployment-ready full-stack system with shared backend and four role-based experiences:
- Admin console
- Restaurant portal
- Customer ordering portal
- Driver operations portal

## Stack
- React + Vite frontend
- Node.js + Express + TypeScript backend
- PostgreSQL + PostGIS
- Docker Compose for one-command local deployment
- Local image upload storage mounted through Docker volume
- Order-based chat and browser voice call signaling for customer ↔ driver communication

## Seed accounts
- Admin: `admin@foodsuite.local` / `admin123`
- Restaurant owner: `owner@urbanbites.local` / `restaurant123`
- Restaurant staff: `staff@urbanbites.local` / `restaurant123`
- Customer: `customer@foodsuite.local` / `customer123`
- Driver: `driver@foodsuite.local` / `driver123`

## Included functionality
### Admin
- dashboard KPIs
- restaurant oversight
- user list
- order list
- driver monitoring
- customer monitoring

### Restaurant
- restaurant onboarding/registration
- logo upload
- banner upload
- menu category CRUD
- menu item CRUD
- dish image upload
- order management
- inventory view

### Customer
- customer registration
- restaurant discovery
- menu browsing
- cart management
- address management
- checkout to order
- order history
- chat with assigned driver by order
- browser voice call with assigned driver

### Driver
- driver onboarding/registration
- driver profile photo upload
- open/assigned deliveries
- accept delivery
- status progression
- location ping
- earnings view
- chat with assigned customer by order
- browser voice call with customer

## Build stability fixes
- Docker images use Node 20 Alpine for better npm stability.
- Docker builds install from the public npm registry explicitly.
- Clean package-lock files are regenerated from public npm.
- Upload files persist through the `backend_uploads` Docker volume.

## Clean start
```bash
docker compose down -v --remove-orphans
docker compose build --no-cache
docker compose up
```

Open:
- Frontend: http://localhost:5173/login
- Backend health: http://localhost:4000/api/health

## Important notes
- Image uploads are stored locally by the backend at `/app/uploads` and exposed through `/uploads/...` URLs.
- Voice calling uses WebRTC with REST polling + a public STUN server. It works best when both participants have the order open in the app. For production internet-grade reliability across all network types, add a TURN server.
- The schema is PostGIS-safe and avoids dropping extension-owned views during reset.
- Database bootstrap runs schema + seed when needed.


## Mobile app (Expo)

A new `mobile/` Expo app is included for customer and driver testing on Android/iOS.

```bash
cd mobile
npm install
npx expo start
```

Set the API base URL in `mobile/app.json` if your phone uses a different LAN IP than the default emulator host.

## Key production-focused updates

- customer, driver, and restaurant registration hardened with phone/email normalization and uniqueness checks
- brighter food-delivery UI for web/tablet workspaces
- instant order status timeline with live driver location snapshots
- customer loyalty, featured restaurants, support ticket hooks, and post-delivery reviews
- order chat and call foundation retained


## Production features added

- Socket.IO realtime events for order status, chat, calls, and driver tracking
- TURN-ready WebRTC config via backend env variables
- Expo push token registration and backend push dispatch through the Expo push API
- Payment session + confirmation endpoints with provider config placeholders
- Driver compliance document uploads and restaurant KYC uploads (images/PDF)

### New backend environment variables

- `SOCKET_ORIGIN`
- `PAYMENT_PROVIDER`
- `PAYMENT_PUBLISHABLE_KEY`
- `PAYMENT_CHECKOUT_BASE_URL`
- `TURN_URLS`
- `TURN_USERNAME`
- `TURN_CREDENTIAL`

### Notes

- For production voice calling, set a real TURN server in the backend env variables.
- The payment module is provider-ready and persists payment sessions/attempts in the database, but you still need to plug in your live gateway keys and hosted checkout flow.
- Expo push notifications require real devices for end-to-end testing.


## Mobile on Expo Go (real phone)

- Run the backend so it is reachable on port `4000`.
- The backend in this package listens on `0.0.0.0`.
- On the mobile auth screen, set the backend URL to your laptop Wi-Fi IP, for example `http://192.168.170.137:4000`.
- Keep the phone and laptop on the same Wi-Fi.
- If needed, allow port `4000` through Windows Firewall.
