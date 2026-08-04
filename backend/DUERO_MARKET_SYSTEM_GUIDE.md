# Duero Market — Commercial Spaces Services (CSS) System
## Complete System Architecture & Logic Guide

> **Purpose**: This document is the definitive reference for rebuilding the Duero Market system with a modern tech stack: **React.js + Vite + TailwindCSS** (frontend) and **Node.js** (backend) with **MySQL / SQLyog** (database).
> It captures every page, database table, business rule, API flow, and user interaction from the original PHP codebase.

---

## Table of Contents

1. [System Overview](#1-system-overview)
2. [Tech Stack (Original → New)](#2-tech-stack)
3. [Database Schema](#3-database-schema)
4. [Authentication & Authorization](#4-authentication--authorization)
5. [Role-Based Access & Navigation](#5-role-based-access--navigation)
6. [File Structure (Original)](#6-file-structure-original)
7. [Recommended New File Structure](#7-recommended-new-file-structure)
8. [Page-by-Page Functionality](#8-page-by-page-functionality)
9. [Core Business Logic](#9-core-business-logic)
10. [API Endpoints to Build](#10-api-endpoints-to-build)
11. [Security Considerations](#11-security-considerations)
12. [UI/UX Design System](#12-uiux-design-system)

---

## 1. System Overview

**Duero Market** is a Commercial Spaces Services (CSS) management system for the **Duero Public Market** in Duero, Bohol, Philippines. It digitalizes the management of:

- **Market stall/space inventory** — create, edit, track availability
- **Renter management** — register, approve/reject, assign spaces
- **Billing & invoicing** — generate bills, track balances, record payments
- **Transaction history** — full payment audit trail
- **Reporting & analytics** — revenue charts, occupancy rates, KPIs

### Three User Roles

| Role     | Description                                                       |
|----------|-------------------------------------------------------------------|
| **Admin**  | Full system control: manage users, spaces, view reports, approve renters |
| **Staff**  | Operational: manage spaces, create rentals, billing, record payments     |
| **Renter** | Self-service: view assigned space, balance, transactions, browse spaces  |

---

## 2. Tech Stack

### Original (Current PHP System)

| Layer      | Technology                          |
|------------|-------------------------------------|
| Backend    | PHP 8.3 (procedural, PDO)           |
| Frontend   | HTML + TailwindCSS CDN + Vanilla JS |
| Database   | MySQL 8.4 (via XAMPP/phpMyAdmin)    |
| Charts     | Chart.js (CDN)                      |
| Font       | Google Fonts — Outfit               |
| Auth       | PHP Sessions + bcrypt               |

### New Target Stack

| Layer      | Technology                          |
|------------|-------------------------------------|
| Frontend   | **React.js** + **Vite** + **TailwindCSS** |
| Backend    | **Node.js** (Express.js recommended) |
| Database   | **MySQL** (managed via **SQLyog**)  |
| ORM        | Sequelize or Knex.js (recommended)  |
| Auth       | JWT (JSON Web Tokens) + bcrypt      |
| Charts     | Chart.js or Recharts                |
| Font       | Google Fonts — Outfit               |

---

## 3. Database Schema

Database name: `duero_market_db`
Charset: `utf8mb4_unicode_ci`

### 3.1 `users` Table

```sql
CREATE TABLE users (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  role          ENUM('admin','staff','renter') NOT NULL,
  first_name    VARCHAR(50) NOT NULL,
  middle_name   VARCHAR(50),
  last_name     VARCHAR(50) NOT NULL,
  email         VARCHAR(100) UNIQUE NOT NULL,
  password      VARCHAR(255) NOT NULL,       -- bcrypt hash
  password_plain VARCHAR(255),               -- stored plaintext (admin visibility)
  contact_number VARCHAR(20),
  address       TEXT,
  gender        VARCHAR(20),
  civil_status  VARCHAR(20),
  valid_id      LONGBLOB,                    -- uploaded ID image
  profile_image VARCHAR(255),                -- filename in assets/images/profiles/
  status        ENUM('active','inactive') DEFAULT 'active',
  approval_status ENUM('pending','approved','rejected') DEFAULT 'approved',
  created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

**Key business rules:**
- Admin creates staff/renter accounts
- Renter self-registration creates account with `status='inactive'`, `approval_status='pending'`
- Admin must approve renter before they can login
- `password_plain` is stored for admin visibility (the admin can see/reset passwords)
- Email pattern: `{firstname}{lastname}@duero.com`
- Default password pattern: `{Firstname}1234`

### 3.2 `spaces` Table

```sql
CREATE TABLE spaces (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  space_number  VARCHAR(20) UNIQUE NOT NULL,
  location      VARCHAR(100),
  size_sqm      DECIMAL(10,2),
  monthly_rate  DECIMAL(10,2) NOT NULL,
  image         LONGBLOB,                    -- space photo stored as binary
  status        ENUM('available','rented','maintenance') DEFAULT 'available',
  description   TEXT,
  created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  KEY idx_status (status)
);
```

**Key business rules:**
- `space_number` must be unique
- Status changes: `available` → `rented` (when rental approved) → `available` (when terminated)
- Images stored as LONGBLOB (base64 encoded for display)
- `monthly_rate` is actually used as a **yearly rate** in the billing system

### 3.3 `rentals` Table

```sql
CREATE TABLE rentals (
  id                   INT AUTO_INCREMENT PRIMARY KEY,
  renter_id            INT NOT NULL,
  space_id             INT NOT NULL,
  start_date           DATE NOT NULL,
  end_date             DATE,
  status               ENUM('active','terminated','expired','pending') DEFAULT 'active',
  created_by_staff_id  INT,
  valid_id_snapshot     LONGBLOB,            -- copy of renter's valid ID at time of rental
  created_at           TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  KEY idx_renter_status (renter_id, status),
  KEY idx_space_status (space_id, status)
);
```

**Key business rules:**
- One renter can have multiple rentals (multiple spaces)
- `pending` status = awaiting admin approval
- When approved: rental → `active`, space → `rented`, user → `active` + `approved`
- When rejected: rental → `terminated`, user → `inactive` + `rejected`
- `end_date` is set to the billing due date (typically 1 year from start)

### 3.4 `billings` Table

```sql
CREATE TABLE billings (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  renter_id     INT NOT NULL,
  rental_id     INT NOT NULL,
  billing_month DATE NOT NULL,
  amount_due    DECIMAL(10,2) NOT NULL,       -- yearly rate from space
  downpayment   DECIMAL(10,2) DEFAULT 0,      -- initial down payment
  balance       DECIMAL(10,2) NOT NULL,        -- remaining = amount_due - payments
  due_date      DATE NOT NULL,
  status        ENUM('unpaid','paid','overdue','waived') DEFAULT 'unpaid',
  created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  KEY rental_id (rental_id),
  KEY idx_billing_month (billing_month),
  KEY idx_renter_status (renter_id, status)
);
```

**Key business rules:**
- Created via "Billing Setup" by staff (not auto-generated monthly)
- `amount_due` = space's `monthly_rate` (which represents the yearly rate)
- `balance` = `amount_due` - `downpayment` - subsequent payments
- When `balance` reaches 0, `status` becomes `paid`
- Monthly installment = `(amount_due - downpayment) / 12`
- Staff can manually set status to `overdue` or `waived`
- Only `unpaid` billings can be deleted

### 3.5 `payments` Table

```sql
CREATE TABLE payments (
  id                    INT AUTO_INCREMENT PRIMARY KEY,
  billing_id            INT NOT NULL,
  renter_id             INT NOT NULL,
  amount_paid           DECIMAL(10,2) NOT NULL,
  payment_type          VARCHAR(20) DEFAULT 'monthly',  -- monthly, yearly, down_payment
  balance_after         DECIMAL(10,2) DEFAULT 0,
  payment_date          DATETIME NOT NULL,
  payment_method        VARCHAR(50) DEFAULT 'Cash',
  reference_number      VARCHAR(100),
  received_by_staff_id  INT,
  created_at            TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  KEY renter_id (renter_id),
  KEY idx_payment_date (payment_date),
  KEY idx_billing_id (billing_id)
);
```

**Key business rules:**
- Payments are applied to **oldest unpaid billing first** (FIFO)
- A single payment can span multiple billing records if amount exceeds first bill's balance
- Amount paid **cannot exceed** total unpaid balance
- Payment is always recorded against a specific `billing_id`
- `received_by_staff_id` tracks which staff processed the payment
- `payment_type`: `monthly` (installment), `yearly` (full balance), `down_payment` (initial)

### Entity Relationship Diagram

```
users (1) ──── (M) rentals (M) ──── (1) spaces
  │                  │
  │                  │
  (1)               (1)
  │                  │
  (M)               (M)
billings ────────── billings
  │
  (1)
  │
  (M)
payments
```

---

## 4. Authentication & Authorization

### Login Flow

1. User submits email + password to `POST /login`
2. Server queries `users` where `email = ?`
3. Validates: `status === 'active'` AND `password_verify(input, hash)`
4. On success: creates session with `user_id`, `role`, `email`
5. Redirects to role-specific dashboard:
   - `admin` → `/admin/dashboard`
   - `staff` → `/staff/dashboard`
   - `renter` → `/renter/dashboard`
6. On failure: flash error "Invalid credentials or inactive account"

### Session Configuration

```javascript
// Original PHP session config — replicate with JWT
{
  lifetime: 1800,     // 30 minutes
  httponly: true,
  samesite: 'Lax'
}
```

### CSRF Protection

- Every form includes a `csrf_token` hidden field
- Token generated with `bin2hex(random_bytes(32))`
- Validated on every POST request
- **For React**: Use JWT tokens instead; CSRF is handled differently in SPA architecture

### Authorization Middleware

```javascript
// requireAuth() — check if user is logged in
// requireRole(['admin']) — check if user has required role
// Both redirect to /login if unauthorized
```

---

## 5. Role-Based Access & Navigation

### Admin Sidebar Menu

| Label         | Route                | Description                    |
|---------------|----------------------|--------------------------------|
| Overview      | `/admin/dashboard`   | KPI metrics, revenue chart     |
| Profile       | `/admin/profile`     | Edit own profile               |
| Users         | `/admin/users`       | CRUD all staff & renter accounts |
| Renters       | `/admin/renters`     | View renter list with assigned spaces |
| Browse Space  | `/admin/spaces`      | CRUD spaces, approve/reject rentals |
| Transactions  | `/admin/transactions`| View all payment transactions  |
| Reports       | `/admin/reports`     | Revenue, occupancy, renter reports |

### Staff Sidebar Menu

| Label         | Route                | Description                    |
|---------------|----------------------|--------------------------------|
| Overview      | `/staff/dashboard`   | Staff-level KPIs               |
| Profile       | `/staff/profile`     | Edit own profile               |
| Renters       | `/staff/renters`     | View/manage renters            |
| Browse Space  | `/staff/spaces`      | Manage spaces, assign renters  |
| Payments      | `/staff/payments`    | Record payments                |
| Billing       | `/staff/billing`     | Create/manage billing records  |

### Renter Sidebar Menu

| Label          | Route                   | Description                 |
|----------------|-------------------------|-----------------------------|
| Overview       | `/renter/dashboard`     | Personal KPIs, recent payments |
| Profile        | `/renter/profile`       | Edit own profile            |
| Availed Space  | `/renter/availed_space` | View assigned spaces        |
| Browse Space   | `/renter/spaces`        | Browse all market spaces    |
| Transactions   | `/renter/transactions`  | View own payment history    |

---

## 6. File Structure (Original)

```
duero_market/
├── config/
│   └── db.php                     # Database connection (PDO) + auto-migrations
├── includes/
│   ├── auth.php                   # Session management, CSRF, role checking
│   ├── functions.php              # Utility: sanitize, flash, redirect
│   ├── header.php                 # HTML head, top bar, sidebar include
│   ├── sidebar.php                # Role-based navigation menu
│   └── footer.php                 # Closing tags, footer content
├── assets/
│   ├── css/
│   └── images/
│       ├── logo1.png              # Primary logo
│       ├── logo2.jpg              # Secondary logo
│       ├── block1-8.jpg           # Fallback space images
│       └── profiles/              # Profile image uploads
├── admin/
│   ├── dashboard.php              # Admin KPIs + revenue chart
│   ├── profile.php                # Admin profile management
│   ├── users.php                  # CRUD users (staff/renter)
│   ├── renters.php                # Read-only renter list
│   ├── spaces.php                 # CRUD spaces + approve/reject rentals
│   ├── transactions.php           # View all transactions
│   └── reports.php                # Reports & analytics
├── staff/
│   ├── dashboard.php              # Staff KPIs
│   ├── profile.php                # Staff profile
│   ├── renters.php                # Manage renters
│   ├── spaces.php                 # Manage spaces + assign renters (AJAX)
│   ├── payments.php               # Record payments (monthly/yearly)
│   └── billing.php                # Billing setup & management
├── renter/
│   ├── dashboard.php              # Renter personal KPIs
│   ├── profile.php                # Renter profile
│   ├── availed_space.php          # View assigned spaces
│   ├── spaces.php                 # Browse all spaces
│   └── transactions.php           # View own transactions
├── index.php                      # Public landing page
├── login.php                      # Login page
├── logout.php                     # Session destroy + redirect
└── duero_market_db (1).sql        # Database dump/schema
```

---

## 7. Recommended New File Structure

```
duero-market/
├── client/                        # React + Vite + TailwindCSS
│   ├── public/
│   │   └── assets/images/
│   ├── src/
│   │   ├── components/
│   │   │   ├── layout/
│   │   │   │   ├── Header.jsx
│   │   │   │   ├── Sidebar.jsx
│   │   │   │   ├── Footer.jsx
│   │   │   │   └── DashboardLayout.jsx
│   │   │   ├── ui/
│   │   │   │   ├── FlashMessage.jsx
│   │   │   │   ├── Modal.jsx
│   │   │   │   ├── Pagination.jsx
│   │   │   │   ├── SearchBar.jsx
│   │   │   │   ├── StatusBadge.jsx
│   │   │   │   └── DataTable.jsx
│   │   │   └── charts/
│   │   │       └── RevenueChart.jsx
│   │   ├── pages/
│   │   │   ├── public/
│   │   │   │   ├── Landing.jsx
│   │   │   │   └── Login.jsx
│   │   │   ├── admin/
│   │   │   │   ├── Dashboard.jsx
│   │   │   │   ├── Users.jsx
│   │   │   │   ├── Renters.jsx
│   │   │   │   ├── Spaces.jsx
│   │   │   │   ├── Transactions.jsx
│   │   │   │   ├── Reports.jsx
│   │   │   │   └── Profile.jsx
│   │   │   ├── staff/
│   │   │   │   ├── Dashboard.jsx
│   │   │   │   ├── Renters.jsx
│   │   │   │   ├── Spaces.jsx
│   │   │   │   ├── Payments.jsx
│   │   │   │   ├── Billing.jsx
│   │   │   │   └── Profile.jsx
│   │   │   └── renter/
│   │   │       ├── Dashboard.jsx
│   │   │       ├── AvailedSpace.jsx
│   │   │       ├── Spaces.jsx
│   │   │       ├── Transactions.jsx
│   │   │       └── Profile.jsx
│   │   ├── hooks/
│   │   │   ├── useAuth.js
│   │   │   └── useFlash.js
│   │   ├── context/
│   │   │   └── AuthContext.jsx
│   │   ├── services/
│   │   │   └── api.js              # Axios instance
│   │   ├── utils/
│   │   │   ├── formatCurrency.js
│   │   │   └── constants.js
│   │   ├── App.jsx
│   │   ├── main.jsx
│   │   └── index.css               # TailwindCSS directives
│   ├── tailwind.config.js
│   ├── vite.config.js
│   └── package.json
│
├── server/                        # Node.js (Express)
│   ├── config/
│   │   └── db.js                  # MySQL connection pool
│   ├── middleware/
│   │   ├── auth.js                # JWT verification
│   │   └── roleGuard.js           # Role-based access
│   ├── routes/
│   │   ├── auth.routes.js
│   │   ├── users.routes.js
│   │   ├── spaces.routes.js
│   │   ├── rentals.routes.js
│   │   ├── billings.routes.js
│   │   ├── payments.routes.js
│   │   └── reports.routes.js
│   ├── controllers/
│   │   ├── auth.controller.js
│   │   ├── users.controller.js
│   │   ├── spaces.controller.js
│   │   ├── rentals.controller.js
│   │   ├── billings.controller.js
│   │   ├── payments.controller.js
│   │   └── reports.controller.js
│   ├── models/                    # Sequelize models (optional)
│   ├── utils/
│   │   └── helpers.js
│   ├── app.js
│   ├── server.js
│   └── package.json
│
└── README.md
```

---

## 8. Page-by-Page Functionality

### 8.1 Public Pages

#### Landing Page (`/`)

A full marketing landing page with sections:

1. **Hero Section** — Animated typewriter text cycling "Spaces" / "Tools", 3D coin-flip logo animation, CTA to login
2. **Features Section** — 3 cards: Space Inventory, Automated Billing, Renter Portal
3. **About Section** — Mission & vision statements, feature tags (Daily Collection, Occupancy Reports, etc.)
4. **Services Section** — Checklist of services + renter requirements (Valid ID, Contact Info, Advance Payment, Rules Agreement)
5. **Spaces Section** — Live from database, paginated (8 per page), shows availability status, modal detail view
6. **Contact Section** — Email, Facebook, Office Hours, Location (Duero, Bohol)
7. **Footer**

**Data queries on landing:**
- `SELECT status, COUNT(*) FROM spaces GROUP BY status` — occupancy stats
- `SELECT * FROM spaces ORDER BY space_number ASC LIMIT 8 OFFSET ?` — paginated spaces

#### Login Page (`/login`)

- Glassmorphism dark theme (`#192338` background)
- Email + Password form with CSRF token
- Social icons: Facebook, Instagram, Google, Twitter (X)
- Flash messages for errors
- "Back to Home" link

#### Logout (`/logout`)

- Destroys session → Redirect to `/login`
- In React: Clear JWT from localStorage + redirect

---

### 8.2 Admin Pages

#### Admin Dashboard (`/admin/dashboard`)

**KPI Cards (4 metrics):**

| Metric             | Query                                                                                     |
|--------------------|-------------------------------------------------------------------------------------------|
| Total Collections  | `SELECT SUM(amount_paid) FROM payments`                                                   |
| Registered Users   | `SELECT COUNT(*) FROM users WHERE role IN ('staff','renter')`                             |
| Occupancy Rate     | `SELECT status, COUNT(*) FROM spaces GROUP BY status` then `(rented/total) * 100`         |
| Pending Approvals  | `SELECT COUNT(*) FROM users WHERE approval_status='pending'`                              |

**Revenue Chart (Chart.js Line):**
- Last 6 months of payment data
- Query: `SELECT DATE_FORMAT(payment_date, '%b'), SUM(amount_paid) FROM payments WHERE payment_date >= DATE_SUB(CURDATE(), INTERVAL 6 MONTH) GROUP BY YEAR, MONTH ORDER BY date ASC`

**Recent Activities:**
- Last 5 payments with renter name, amount, date
- Query: `SELECT p.amount_paid, p.payment_date, u.first_name, u.last_name FROM payments p JOIN users u ON p.renter_id = u.id ORDER BY p.payment_date DESC LIMIT 5`

#### Admin Users (`/admin/users`)

**Create User Form (collapsible):**
- Fields: Role (staff/renter), First Name, Middle Name, Last Name, Email, Password
- Auto-fill: `email = {firstname}{lastname}@duero.com`, `password = {Firstname}1234`
- Quick Fill button for demo data
- Duplicate name check before insert

**Users Table:**
- Columns: ID, User (avatar + name + email), Role badge, Password History (toggle show/hide), Approval status (with Approve/Reject for pending), Status (dropdown: active/inactive auto-submit), Actions (Edit, Delete)
- Search by name/email
- Edit modal: all fields editable, optional password reset

**POST Actions:**
- `create` — Insert new user with bcrypt hash
- `update` — Toggle active/inactive status
- `update_user` — Full edit (name, email, role, status, optional password)
- `approve_renter` — Set user active+approved, activate pending rental + set space to rented
- `reject_renter` — Set user inactive+rejected, terminate pending rental
- `delete` — Delete user

#### Admin Renters (`/admin/renters`)

**Read-only table of all renters:**
- Columns: Renter Details (avatar + name + ID), Contact Info (email + phone), Assigned Space (from active rental), Password History, Status badge, Registration date
- Search by name/email
- JOIN: `users LEFT JOIN rentals LEFT JOIN spaces`

#### Admin Spaces (`/admin/spaces`)

**Pending Rental Approvals** (shown if any exist):
- Table: Renter Info, Space, Contact, Dates, Rate, Approve/Reject buttons
- Query: `SELECT FROM rentals r JOIN users u JOIN spaces s WHERE r.status = 'pending'`

**Create Space Form (collapsible):**
- Fields: Space Number, Location, Size (m2), Monthly Rate, Image upload, Description
- Duplicate space number check

**Spaces Table (paginated, 8/page):**
- Columns: Space (thumbnail + number + location), Specs (size), Financials (rate), Status (dropdown), Actions (Edit)
- Status filter dropdown (All/Available/Rented)
- Click row → Detail Modal (image, status badge, size, rate, description)
- Edit Modal: all fields editable + optional new image

**POST Actions:**
- `create` — Insert new space
- `modify` — Update space details + optional image
- `approve_rental` — Transaction: activate rental + mark space rented + activate renter user
- `reject_rental` — Transaction: terminate rental + deactivate renter

#### Admin Transactions (`/admin/transactions`)

- Full payment history table
- Joins: payments → billings → users → rentals → spaces

#### Admin Reports (`/admin/reports`)

- Revenue reports, occupancy analytics, renter ledger
- Exportable data

---

### 8.3 Staff Pages

#### Staff Dashboard (`/staff/dashboard`)

- Similar KPI cards to admin but scoped to staff's operational view
- Revenue chart, recent activities

#### Staff Spaces (`/staff/spaces`)

**Full space management + rental assignment:**

**AJAX Renter Lookup:**
- Endpoint: `GET ?ajax_search_renter&email={email}`
- Returns: renter ID, name, contact, gender, civil status, address, unpaid bill count
- Used to pre-fill rental assignment form

**Create Rental Flow:**
1. Staff selects an available space → clicks "Assign Renter"
2. Modal opens with space details pre-filled
3. Staff enters renter email → AJAX lookup fills renter details
4. Staff sets start date, end date
5. On submit: creates rental record with `status='pending'`, renter gets `approval_status='pending'`
6. Rental appears in Admin's pending approvals queue

**POST Actions:**
- `update` — Update space status + rate
- `delete` — Delete space
- `modify` — Edit space details + optional image
- `assign` — Create pending rental (links renter to space)

#### Staff Payments (`/staff/payments`)

**Payment Type Tabs:**
- **Monthly** — Auto-calculates: `(amount_due - downpayment) / 12`
- **Yearly** — Auto-fills total unpaid balance

**Process Payment Form:**
- Select Active Renter (dropdown shows name + space + current balance)
- Starting Month (auto-selects oldest unpaid month)
- Payment Method (Cash)
- Due Date
- Reference # (optional)
- Amount to Pay (auto-calculated, validated against balance)
- Real-time summary: Total to Collect, breakdown

**Payment Recording Logic (critical — FIFO):**
```
1. Validate: amount_paid <= total_unpaid_balance
2. Fetch all unpaid billings for rental (oldest first — FIFO)
3. For each billing:
   a. Apply payment (min of remaining_amount, bill_balance)
   b. Calculate new_balance = bill_balance - applied_amount
   c. If new_balance <= 0: set billing status = 'paid'
   d. Insert payment record with balance_after
   e. Update billing balance and status
   f. Deduct applied_amount from remaining
4. Commit transaction
```

**Recent Transactions Table:**
- Last 30 transactions
- Columns: Renter, Space, Amount Paid, Balance After, Type badge, Method badge, Date, Reference
- Client-side search by renter name (JS filter, no reload)

#### Staff Billing (`/staff/billing`)

**Billing Setup Modal:**
1. Select Rental (dropdown: renters without existing billing)
2. Start Date / Month
3. Down Payment amount
4. Payment Due Date (default: 1 year from now)
5. Real-time display: Net Balance = `rate - downpayment`, Monthly Payment = `net / 12`

**Billing Setup Logic:**
```
1. Get rental's space monthly_rate (yearly rate)
2. Calculate balance = monthly_rate - down_payment
3. Determine status: balance <= 0 ? 'paid' : 'unpaid'
4. INSERT billing record
5. UPDATE rental end_date = due_date
6. If down_payment > 0: INSERT payment record
7. Commit transaction
```

**Billings Table:**
- Columns: Reference (#BIL-00001), Renter, Amount Due, Balance, Due Date, Status badge, Actions
- Status update dropdown (Unpaid → Overdue/Waived)
- Delete (only unpaid)
- Search by name/email

---

### 8.4 Renter Pages

#### Renter Dashboard (`/renter/dashboard`)

**KPI Cards:**

| Metric           | Query                                                                           |
|------------------|---------------------------------------------------------------------------------|
| Active Units     | `SELECT COUNT(*) FROM rentals WHERE renter_id=? AND status='active'`            |
| Outstanding      | `SELECT SUM(balance) FROM billings WHERE renter_id=? AND status != 'paid'`      |
| Next Due Date    | `SELECT MIN(due_date) FROM billings WHERE renter_id=? AND status != 'paid'`     |
| Total Paid       | `SELECT SUM(amount_paid) FROM payments WHERE renter_id=?`                       |

**Recent Payments List:**
- Last 5 payments with date, amount, billing month

#### Renter Spaces (`/renter/spaces`)

- Browse all spaces (read-only)
- Filter: All / Available / Rented
- Paginated (8 per page)
- Table with click-to-view detail modal (image, size, rate, status, description)

#### Renter Availed Space (`/renter/availed_space`)

- Shows only the renter's actively rented spaces
- Space details: number, location, size, rate, start date, end date

#### Renter Transactions (`/renter/transactions`)

- Own payment history only
- Columns: Amount, Method, Date, Reference, Billing Month

#### Renter/Staff/Admin Profile Pages

- View/edit: name, email, contact, address, gender, civil status
- Upload/change profile image
- Change password (with current password verification)

---

## 9. Core Business Logic

### 9.1 Rental Assignment Flow

```
1. Staff browses available spaces
2. Staff clicks "Assign Renter" on an available space
3. Staff enters renter's email → system looks up renter via AJAX
4. Staff fills in start_date, end_date
5. System creates: rental(status='pending'), user(approval_status='pending')
6. Admin sees pending rental in Spaces page
7a. Admin APPROVES → rental='active', space='rented', user='active'+'approved'
7b. Admin REJECTS → rental='terminated', user='inactive'+'rejected'
```

### 9.2 Billing Lifecycle

```
1. Staff opens Billing Setup
2. Selects a rental that has NO existing billing
3. Sets down payment and due date
4. System creates billing: amount_due = yearly_rate, balance = yearly_rate - downpayment
5. If downpayment > 0, creates payment record
6. Monthly installment = balance / 12
7. Staff records monthly payments against this billing
8. Each payment reduces billing balance
9. When balance = 0, billing status → 'paid'
```

### 9.3 Payment Processing (FIFO)

```
1. Staff selects renter (shows total unpaid balance)
2. Chooses payment type: Monthly (auto-calc) or Yearly (full balance)
3. Enters amount (validated: cannot exceed total balance)
4. System processes:
   - Finds all unpaid billings for rental, ordered oldest first
   - Applies payment amount across billings sequentially
   - Updates each billing's balance and status
   - Records payment with balance_after snapshot
5. All within a database transaction (rollback on error)
```

### 9.4 Currency

- Philippine Peso (PHP)
- Format: `₱{number_format(value, 2)}` → e.g., `₱40,000.00`
- Timezone: `Asia/Manila`

---

## 10. API Endpoints to Build

### Auth

| Method | Endpoint            | Description              | Access  |
|--------|---------------------|--------------------------|---------|
| POST   | `/api/auth/login`   | Login, return JWT         | Public  |
| POST   | `/api/auth/logout`  | Invalidate token          | Auth    |
| GET    | `/api/auth/me`      | Get current user profile  | Auth    |

### Users

| Method | Endpoint                    | Description                       | Access  |
|--------|-----------------------------|-----------------------------------|---------|
| GET    | `/api/users`                | List users (filter by role/search)| Admin   |
| POST   | `/api/users`                | Create user                       | Admin   |
| PUT    | `/api/users/:id`            | Update user details               | Admin   |
| PATCH  | `/api/users/:id/status`     | Toggle active/inactive            | Admin   |
| PATCH  | `/api/users/:id/approve`    | Approve renter                    | Admin   |
| PATCH  | `/api/users/:id/reject`     | Reject renter                     | Admin   |
| DELETE | `/api/users/:id`            | Delete user                       | Admin   |

### Spaces

| Method | Endpoint                    | Description                       | Access       |
|--------|-----------------------------|-----------------------------------|-------------|
| GET    | `/api/spaces`               | List spaces (filter, paginate)    | Auth        |
| GET    | `/api/spaces/:id`           | Get space detail                  | Auth        |
| POST   | `/api/spaces`               | Create space                      | Admin       |
| PUT    | `/api/spaces/:id`           | Update space                      | Admin/Staff |
| PATCH  | `/api/spaces/:id/status`    | Update space status               | Admin/Staff |

### Rentals

| Method | Endpoint                       | Description                    | Access  |
|--------|--------------------------------|--------------------------------|---------|
| GET    | `/api/rentals`                 | List rentals                   | Auth    |
| GET    | `/api/rentals/pending`         | List pending rentals           | Admin   |
| POST   | `/api/rentals`                 | Create rental (assign renter)  | Staff   |
| PATCH  | `/api/rentals/:id/approve`     | Approve rental                 | Admin   |
| PATCH  | `/api/rentals/:id/reject`      | Reject rental                  | Admin   |
| GET    | `/api/rentals/lookup?email=`   | AJAX renter lookup             | Staff   |

### Billings

| Method | Endpoint                       | Description                    | Access  |
|--------|--------------------------------|--------------------------------|---------|
| GET    | `/api/billings`                | List billings (search)         | Staff   |
| POST   | `/api/billings/setup`          | Create billing + optional payment | Staff   |
| PATCH  | `/api/billings/:id/status`     | Update billing status          | Staff   |
| DELETE | `/api/billings/:id`            | Delete unpaid billing          | Staff   |

### Payments

| Method | Endpoint                       | Description                    | Access  |
|--------|--------------------------------|--------------------------------|---------|
| GET    | `/api/payments`                | List payments (limit 30)       | Staff   |
| GET    | `/api/payments/renter/:id`     | Get renter's payments          | Auth    |
| POST   | `/api/payments`                | Record payment (FIFO logic)    | Staff   |

### Reports & Dashboard

| Method | Endpoint                          | Description                       | Access  |
|--------|-----------------------------------|-----------------------------------|---------|
| GET    | `/api/dashboard/admin`            | Admin KPIs + chart data           | Admin   |
| GET    | `/api/dashboard/staff`            | Staff KPIs                        | Staff   |
| GET    | `/api/dashboard/renter`           | Renter personal KPIs              | Renter  |
| GET    | `/api/reports/revenue`            | Revenue reports                   | Admin   |
| GET    | `/api/reports/occupancy`          | Occupancy analytics               | Admin   |

### Profile

| Method | Endpoint                       | Description                    | Access  |
|--------|--------------------------------|--------------------------------|---------|
| GET    | `/api/profile`                 | Get own profile                | Auth    |
| PUT    | `/api/profile`                 | Update own profile             | Auth    |
| POST   | `/api/profile/image`           | Upload profile image           | Auth    |
| PUT    | `/api/profile/password`        | Change password                | Auth    |

---

## 11. Security Considerations

### Original System Concerns (to fix in rebuild)

| Issue                           | Fix in New System                              |
|---------------------------------|------------------------------------------------|
| Plaintext passwords stored      | Remove `password_plain` column entirely        |
| CSRF via session tokens         | Use JWT + SameSite cookies or token headers    |
| SQL via prepared statements     | Continue using parameterized queries           |
| XSS via htmlspecialchars        | React auto-escapes; sanitize on server side    |
| No rate limiting                | Add rate limiting middleware (express-rate-limit)|
| No input validation             | Add Joi/Yup schema validation on backend       |
| Image stored as BLOB            | Store in filesystem or cloud (S3), save path   |
| Session fixation handled        | JWT is stateless; use refresh tokens           |

### Recommended Security for New System

1. **JWT Authentication** with short-lived access tokens (15min) + refresh tokens (7d)
2. **bcrypt** for password hashing (cost factor 12)
3. **Helmet.js** for HTTP security headers
4. **CORS** whitelist for frontend origin
5. **Input validation** with Joi/express-validator
6. **File upload** validation (type, size limits)
7. **SQL injection** protection via parameterized queries / ORM
8. **Rate limiting** on login endpoint

---

## 12. UI/UX Design System

### Color Palette

```javascript
// Primary (Blue - used across the system)
primary: {
  50:  '#eff6ff', 100: '#dbeafe', 200: '#bfdbfe',
  300: '#93c5fd', 400: '#60a5fa', 500: '#3b82f6',
  600: '#2563eb', 700: '#1d4ed8', 800: '#1e40af',
  900: '#1e3a8a'
}

// Login page uses sky blue variant:
primary_login: {
  50:  '#f0f9ff', 500: '#0ea5e9', 600: '#0284c7',
  700: '#0369a1', 800: '#075985', 900: '#0c4a6e'
}

// Semantic Colors:
// Success:  emerald-500 (#10b981)
// Warning:  amber-500   (#f59e0b)
// Danger:   rose-500    (#f43f5e)
// Info:     primary-500
```

### Typography

- **Font Family**: `'Outfit', sans-serif` (Google Fonts)
- **Weights Used**: 300, 400, 500, 600, 700, 800, 900

### Layout

- **Sidebar**: Fixed left, 16rem expanded / 5rem collapsed, `bg-slate-900`
- **Main Content**: Flex column with sticky header
- **Responsive**: Sidebar hidden on mobile, overlay toggle
- **Cards**: `rounded-3xl`, `border border-slate-200`, `shadow-sm`, hover → `shadow-xl`
- **Tables**: Full-width, `rounded-2xl`, hover row highlight
- **Modals**: Centered, backdrop blur, `rounded-[2.5rem]`, z-index stacking
- **Buttons**: `rounded-xl` / `rounded-2xl`, `shadow-lg`, `active:scale-[0.98]`

### Status Badges

| Status    | Style                                         |
|-----------|-----------------------------------------------|
| Active    | `bg-emerald-50 text-emerald-700`              |
| Inactive  | `bg-rose-50 text-rose-700`                    |
| Pending   | `bg-amber-50 text-amber-700`                  |
| Approved  | `bg-emerald-50 text-emerald-700`              |
| Rejected  | `bg-rose-50 text-rose-700`                    |
| Available | `bg-emerald-50 text-emerald-700`              |
| Rented    | `bg-primary-50 text-primary-700`              |
| Paid      | `bg-emerald-50 text-emerald-700`              |
| Unpaid    | `bg-amber-50 text-amber-700`                  |
| Overdue   | `bg-rose-50 text-rose-700`                    |
| Waived    | `bg-slate-50 text-slate-700`                  |

### Animations

- **Sidebar**: `transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1)`
- **Hover cards**: `hover:-translate-y-1 transition-all duration-300`
- **Landing hero**: Float animation (6s ease-in-out infinite), typewriter text
- **Coin flip**: 3D rotate Y with `transform-style: preserve-3d`
- **Modals**: `animate-in zoom-in duration-300`
- **Flash messages**: `animate-in fade-in slide-in-from-top-2 duration-300`

---

## Quick Reference: Default Credentials Pattern

| Field    | Pattern                                           |
|----------|---------------------------------------------------|
| Email    | `{firstname}{lastname}@duero.com` (lowercase)     |
| Password | `{Firstname}1234` (first letter capitalized)       |

**Example**: First Name: `Mark`, Last Name: `Cruz`
- Email: `markcruz@duero.com`
- Password: `Mark1234`

---

> **This document serves as the complete blueprint for rebuilding the Duero Market system. Every database table, every business rule, every page interaction, and every UI pattern has been documented for faithful recreation with the new tech stack.**
