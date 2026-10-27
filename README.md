# EquipRent: Role-Based Equipment Rental & Maintenance Management System

A robust, cloud-connected enterprise equipment rental and management platform built for advanced database engineering and role-based access control (RBAC).

---

## 🛠️ Tech Stack & Unified Architecture
- **Architecture**: Unified Fullstack Monorepo (Frontend + Backend in one repository)
- **Backend API**: Node.js, Express.js (Express 4/5 compatible, Vercel Serverless ready)
- **Database ORM**: Prisma ORM with live PostgreSQL hosted on **Supabase**
- **Frontend UI**: React.js 19, Vite, Tailwind CSS, Lucide Icons
- **Deployment Target**: Vercel (Frontend CDN + Serverless API Functions) & GitHub
- **Security**: JSON Web Tokens (JWT), bcrypt password hashing, strict server-side `verifyRole` middleware

---

## 🔐 Role-Based Access Control (RBAC) Matrix

| Role | Role ID | Equipment Management | Rentals Management | Maintenance Management | User & Staff Management |
| :--- | :---: | :--- | :--- | :--- | :--- |
| **Admin** | `1` | Full CRUD (Add, Edit, Delete) | Full Access & Returns | Full Access & Completion | Full Access (Change Roles, Delete Users) |
| **Staff** | `2` | Add & Edit (No Deletion) | Create, View & Process Returns | View & Create | Read-Only |
| **Technician** | `3` | Read-Only | Read-Only | Full Operational Control & Completion | No Access |
| **Customer** | `4` | Read-Only (Browse Catalog) | Browse & Create Online Holds | No Access | No Access |

---

## 💻 Running Locally (One Command)

You no longer need to open two separate terminal tabs to run the project.

### 1. Install Dependencies
```bash
npm install
```

### 2. Run Both Frontend & Backend Concurrently
```bash
npm run dev
```
- **Backend**: `http://localhost:5000`
- **Frontend**: `http://localhost:5173` (with `/api` automatic proxy to port 5000)

---

## 🚀 Deployment Guide: GitHub & Vercel with Supabase

### Step 1: Push to GitHub
In your project root directory:
```bash
git init
git add .
git commit -m "feat: unified fullstack equiprent with combined operations table and vercel deployment"
git branch -M main
git remote add origin https://github.com/<your-username>/<your-repo-name>.git
git push -u origin main
```

---

### Step 2: Deploy to Vercel
1. Log in to your [Vercel Dashboard](https://vercel.com).
2. Click **Add New...** -> **Project**.
3. Import your GitHub repository (`EquipRent`).
4. In **Project Settings**:
   - **Framework Preset**: Leave as default or select `Vite` (the included `vercel.json` automatically handles build commands and routes).
   - **Build Command**: `npm run build`
   - **Output Directory**: `frontend/dist`
5. Open the **Environment Variables** section and add:
   - `DATABASE_URL`: `postgresql://postgres.djamqdkcoobsutykdhmj:fuckyousupabase123@aws-0-ap-south-1.pooler.supabase.com:5432/postgres`
   - `JWT_SECRET`: `equiprent_secret_key_101`
6. Click **Deploy**.

---

### Step 3: Verify Live Deployment
- Frontend will load at `https://<your-project>.vercel.app/`
- Backend API endpoints will run serverlessly on the same domain at `https://<your-project>.vercel.app/api`
- Database connects directly to your live Supabase PostgreSQL database.
