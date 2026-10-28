# EquipRent: Architectural Audit & Live Defense Guide
**Course:** Advanced Database Systems  
**Weight:** 100% of Grading Criteria (Live Oral Defense & System Resilience Audit)  
**Target Audience:** All 3 Team Members (DBA, Database Programmer, UI Connector)  

---

## QUESTION 1: THE "WHAT-IF" PARENT DELETION STRESS TEST

### Instructor's Challenge:
> *"I am opening your database management client right now and manually deleting a parent row (e.g. from `equipment` or `user_profiles`). Show me how your framework's relational constraints handle this mutation without throwing an unhandled backend crash."*

### Model Answer & Demonstration:
1. **Explain the SQL Constraint:**
   - In our schema (`supabase/migrations/01_initial_schema.sql`), every child relationship pointing to `equipment` or `user_profiles` is configured with strict foreign key constraints:
     ```sql
     ALTER TABLE rental_order_items
     ADD CONSTRAINT fk_rental_order_items_equipment
     FOREIGN KEY (equipment_id) REFERENCES equipment(id) ON DELETE RESTRICT;
     ```
   - `ON DELETE RESTRICT` guarantees that if any equipment unit is associated with existing rental contracts or service logs, the PostgreSQL engine immediately halts the operation and throws error code `23503` (`foreign_key_violation`).
   - For user accounts linked to audit logs or historic orders, parent user deletion is either restricted or gracefully set to null (`manager_id UUID REFERENCES user_profiles(id) ON DELETE SET NULL`).

2. **Explain the Application Layer Exception Handling:**
   - In `src/services/equipmentService.ts` and `src/services/auditService.ts`, the mutation is wrapped in a guarded try-catch block:
     ```typescript
     const { data, error } = await supabase.from('equipment').delete().eq('id', equipmentId);
     if (error) {
       // Caught error code 23503 without crashing the server process
       return {
         caughtError: true,
         message: error.message,
         sqlConstraint: 'ON DELETE RESTRICT',
         systemCrashPrevented: true,
       };
     }
     ```
   - Do not test this by deleting live equipment from the application. Review the foreign-key definition in the migration, or run a deletion test only in a disposable Supabase project with temporary data.

---

## QUESTION 2: CONNECTION STRING SECURITY & ROOT BAN

### Instructor's Challenge:
> *"Show me your database connection string file. If I look at your production environment variables (.env), how have you restricted your application's connection permissions so it doesn't run on administrative root privileges?"*

### Model Answer & Code Inspection:
1. **Show `.env` / `.env.example`:**
   ```bash
   VITE_SUPABASE_URL=https://[project-ref].supabase.co
   VITE_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
   ```
2. **Defend the Security Architecture:**
   - **Zero Root / Superuser Access:** The application **never** connects using `postgres://postgres:[root_password]@host:5432/postgres`.
   - **Least Privilege Access:** The web client connects using the **Scoped Anon / Authenticated JWT Key**, which runs under PostgreSQL's unprivileged role (`anon` or `authenticated`).
   - **Database-Level Row Level Security (RLS):** In `04_views_and_security.sql`, each table enforces granular RLS policies using `fn_current_user_role()`:
     - Customers can only `SELECT` the catalog and their own `rental_orders` (`customer_id = auth.uid()`).
     - Staff can update dispatch status and conduct inspections.
     - Admins have read access to system triggers and `audit_logs`.
   - Even if a malicious user inspects the browser network tab or steals the public key, they have **zero administrative privileges** and cannot `DROP`, `ALTER`, or query unauthorized customer records.

---

## QUESTION 3: END-TO-END DATA LIFECYCLE WALKTHROUGH

### Instructor's Challenge:
> *"Explain the exact data lifecycle that occurs between the client trigger, the framework's middleware router, and this server-side database transaction block. Walk me through the variables line-by-line."*

### Complete Step-by-Step Walkthrough:
Take the **Equipment Dispatch Workflow** as the primary example. The signed-in staff member selects a confirmed rental order loaded from Supabase; the order and user IDs come from live records.

#### 1. Client Trigger (`src/App.tsx`):
- A staff member clicks **"Dispatch Units (Run Stored Proc)"** for a confirmed order.
- The UI triggers:
  ```typescript
  handleDispatchCheckout(orderId);
  ```

#### 2. Supabase Client (`src/lib/supabase.ts`):
- Function `executeRentalDispatch(orderId, staffId)` passes parameters to Supabase RPC:
  ```typescript
  const { data, error } = await supabase.rpc('sp_process_rental_checkout', {
    p_order_id: orderId,
    p_staff_id: staffId,
  });
  ```
- Uses **Prepared Statements**: parameters are bound as binary values `$1` and `$2`, neutralizing SQL injection payloads.

#### 3. Database Engine Execution (`sp_process_rental_checkout` in `03_stored_procedures.sql`):
- **Variable `v_staff_role`:** Query verifies that `p_staff_id` belongs to an active `'staff'` or `'admin'` user.
- **Variable `v_order_status`:** Selects `status` from `rental_orders` where `id = p_order_id`. Must be `'draft'` or `'confirmed'`.
- **Variable `v_unavailable_item_count`:** Queries `rental_order_items` joined to `equipment` to ensure no equipment unit is marked `'under_maintenance'` or `'rented'`.
- **Loop `FOR v_item IN`:** Iterates through every line item in `rental_order_items`, reads `equipment.operational_hours`, updates `item_status = 'dispatched'`, and records `dispatch_odometer_hours`.
- **Parent State Mutation:** Updates `rental_orders` setting `status = 'in_progress'` and `authorized_staff_id = p_staff_id`.

#### 4. Automatic Database Triggers Fire (`02_triggers_and_audit.sql`):
- **Trigger 1 (`trg_sync_equipment_status`):** When `rental_order_items.item_status` changes to `'dispatched'`, the trigger executes `fn_sync_equipment_rental_status()`, updating `equipment.current_status = 'rented'` automatically at the engine level!
- **Trigger 2 (`trg_audit_rental_order_items` & `trg_audit_rental_orders`):** Executes `fn_universal_audit_logger()`, taking `OLD` and `NEW` row snapshots, computing changed columns, and inserting an audit record into `audit_logs`.

#### 5. Database Response & UI Refresh:
- Stored procedure returns JSON:
  ```json
  {
    "success": true,
    "order_id": "<database order id>",
    "new_status": "in_progress",
    "items_dispatched_count": "<number of order items>",
    "dispatched_at": "<database timestamp>"
  }
  ```
- The React application updates state, re-fetches the synchronized fleet status, and renders the success toast.

---

## 4. Git Version Control Compliance Checklist

The guidelines (Page 3 & 7) explicitly check GitHub commit footprints:
- **Rule 1:** Branch protection active on `main`.
- **Rule 2:** Feature branch workflow (`feature/erd-schema-v1`, `feature/stored-procedures-audit`, `feature/rbac-views`).
- **Rule 3:** Descriptive commit prefixes (`feat: ...`, `fix: ...`, `docs: ...`). Bulk single file drops are heavily penalized.
