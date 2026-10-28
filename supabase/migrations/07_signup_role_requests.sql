-- Store signup role requests without granting elevated roles to new accounts.
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
