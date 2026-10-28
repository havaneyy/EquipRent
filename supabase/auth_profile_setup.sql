-- Configure signup profile linking and access after full_schema_setup.sql.
-- Do not insert directly into Supabase's managed auth.users or auth.identities
-- tables. Create users through Supabase Dashboard > Authentication > Users.

ALTER TABLE public.user_profiles
    ADD COLUMN IF NOT EXISTS requested_role public.user_role_type;

CREATE OR REPLACE FUNCTION public.handle_new_auth_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    INSERT INTO public.user_profiles (
        id,
        auth_user_id,
        full_name,
        email,
        phone,
        company_name,
        role,
        requested_role,
        account_status
    ) VALUES (
        NEW.id,
        NEW.id,
        COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email, '@', 1)),
        NEW.email,
        COALESCE(NULLIF(NEW.raw_user_meta_data->>'phone', ''), ''),
        NULLIF(NEW.raw_user_meta_data->>'company_name', ''),
        'customer',
        CASE
            WHEN NEW.raw_user_meta_data->>'requested_role' IN ('staff', 'admin')
                THEN (NEW.raw_user_meta_data->>'requested_role')::public.user_role_type
            ELSE NULL
        END,
        'active'
    )
    ON CONFLICT (email) DO UPDATE
    SET auth_user_id = EXCLUDED.auth_user_id,
        requested_role = CASE
            WHEN public.user_profiles.role = 'customer'::public.user_role_type THEN EXCLUDED.requested_role
            ELSE public.user_profiles.requested_role
        END,
        updated_at = NOW();

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION public.handle_new_auth_user();

ALTER TABLE public.user_profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS pol_profiles_auth_insert ON public.user_profiles;
DROP POLICY IF EXISTS pol_profiles_auth_update ON public.user_profiles;
DROP POLICY IF EXISTS pol_anon_profiles_select ON public.user_profiles;
DROP POLICY IF EXISTS pol_profiles_auth_select ON public.user_profiles;
DROP POLICY IF EXISTS pol_profiles_self_update ON public.user_profiles;

REVOKE ALL ON TABLE public.user_profiles FROM anon, authenticated;
GRANT SELECT ON TABLE public.user_profiles TO authenticated;
GRANT UPDATE (full_name, phone, company_name, updated_at)
    ON TABLE public.user_profiles TO authenticated;

CREATE POLICY pol_profiles_auth_select ON public.user_profiles
    FOR SELECT TO authenticated
    USING (
        auth_user_id = auth.uid()
        OR id = auth.uid()
        OR public.fn_current_user_role() IN ('admin', 'staff')
    );

CREATE POLICY pol_profiles_self_update ON public.user_profiles
    FOR UPDATE TO authenticated
    USING (auth_user_id = auth.uid() OR id = auth.uid())
    WITH CHECK (auth_user_id = auth.uid() OR id = auth.uid());
