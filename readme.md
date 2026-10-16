# MERN Authentication Starter

This is a starter app for a MERN stack application with authentication. This is for a SPA (Single Page Application) workflow that uses the [Vite](https://vite.dev) Build tool. This authentication workflow is based off of my [MERN Stack From Scratch | eCommerce](https://www.traversymedia.com/mern-stack-from-scratch) course.

<img src="./frontend/public/screen.png" />

It includes the following:

- Backend API with Express & MongoDB
- Quant0 SSO authentication (OAuth 2.1 Authorization Code Flow with PKCE)
- Token verification via local `q0-agent` sidecar
- Protected routes and endpoints using Bearer token authentication
- React frontend with Quant0 hosted login/registration redirect flow
- Profile management
- React Bootstrap UI library
- React Toastify notifications

## Usage

- Create a MongoDB database and obtain your `MongoDB URI` - [MongoDB Atlas](https://www.mongodb.com/cloud/atlas/register)
- Obtain your Quant0 Application `Client ID` from your Quant0 Dashboard

### Env Variables

Rename the `.env.example` file to `.env` and add the following:

```
NODE_ENV=development
PORT=5000
MONGO_URI=your mongodb uri

# Quant0 Config
QUANT0_AGENT_URL=http://127.0.0.1:9595
QUANT0_STRICT_AGENT=true
QUANT0_CLIENT_ID=your_quant0_client_id
QUANT0_GATEWAY_URL=https://dev-api.quant0.io
QUANT0_LOGIN_URL=https://dev-auth.quant0.io
```

### Install Dependencies (frontend & backend)

```
npm install
cd frontend
npm install
```

### Run

```

# Run frontend (:3000) & backend (:5000)
npm run dev

# Run backend only
npm run server
```

## Build & Deploy

```
# Create frontend prod build
cd frontend
npm run build
```
