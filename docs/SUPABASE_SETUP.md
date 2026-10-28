# Supabase Setup

EquipRent is a React/Vite application that reads live records from Supabase using the public anon/publishable key and Row Level Security. The application does not include demo accounts or seed records.

## Configure the app

1. In Supabase, open **Project Settings → API** and copy the project URL and public anon/publishable key.
2. Copy `.env.example` to `.env.local` in the repository root and set:

   ```env
   VITE_SUPABASE_URL=https://your-project-id.supabase.co
   VITE_SUPABASE_ANON_KEY=your-public-anon-or-publishable-key
   ```

3. Restart the Vite development server after changing environment variables. Do not put a database password or service-role key in the browser app.

## Set up a new, empty Supabase project

1. Run `supabase/full_schema_setup.sql` in the Supabase SQL Editor. It creates the schema, triggers, stored procedures, views, and RLS policies without inserting records.
2. Run `supabase/auth_profile_setup.sql` to configure the Auth-to-profile trigger, role requests, and profile access policies.
3. Create an account through EquipRent or Supabase Auth. Self-service signups receive the customer role. An authorized administrator can assign staff/admin roles to trusted profiles.
4. Add real categories, warehouses, equipment, and other operational records through the app or Supabase.

> **Warning:** `full_schema_setup.sql` drops and recreates the application tables. Use it only for a new/empty project. Never rerun it on a database containing data.

## Existing Supabase project

Do not run the destructive full-schema script on an existing project. Apply `supabase/migrations/06_order_insurance_totals.sql` and `supabase/migrations/07_signup_role_requests.sql` in the SQL Editor. The first adds insurance totals; the second adds a signup role-request field and updates the auth profile trigger. Existing records are not deleted by these migrations.

## Auth and permissions

The database trigger creates a customer profile when a new Auth user registers. Signup can record a requested Staff/Admin role, but the account always remains a Customer until an authorized administrator approves and changes the role. Review pending requests in `user_profiles.requested_role`; assign approved roles using the Supabase SQL Editor and clear the request afterward. The trigger uses signup metadata for the person's name and phone and does not invent a phone number or company. Create and confirm accounts through Supabase Auth; do not insert directly into Supabase-managed `auth.users`.

The first account is a customer by design. Staff/admin role changes should only be performed by an authorized administrator. Do not grant elevated roles to untrusted users.

## Existing records

Removing the fixture SQL prevents future setup runs from inserting sample rows; it does not delete records already stored in your Supabase project. Review and remove any unwanted existing records directly in Supabase only after confirming they are not real business data.
