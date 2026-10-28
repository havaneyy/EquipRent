import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type {
  Equipment,
  EquipmentCategory,
  WarehouseLocation,
  RentalOrder,
  MaintenanceRecord,
  AuditLog,
  UserProfile,
  UserRole,
  EquipmentStatus,
  RentalOrderStatus,
} from '../types/database';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL?.trim();
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY?.trim();

export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey);
const supabaseClient: SupabaseClient | null =
  supabaseUrl && supabaseAnonKey ? createClient(supabaseUrl, supabaseAnonKey) : null;

function getSupabaseClient(): SupabaseClient {
  if (!supabaseClient) {
    throw new Error(
      'Supabase is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in .env.local, then restart Vite.'
    );
  }
  return supabaseClient;
}

if (isSupabaseConfigured) {
  console.info('EquipRent connected to the configured Supabase project.');
} else {
  console.error('EquipRent is missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY.');
}

/* =========================================================================
   EQUIPMENT DIRECT SUPABASE QUERIES
   ========================================================================= */

export async function fetchEquipmentList(): Promise<Equipment[]> {
  const { data, error } = await getSupabaseClient()
    .from('equipment')
    .select('*, category:equipment_categories(*)')
    .order('created_at', { ascending: false });

  if (error) {
    console.error('Supabase fetchEquipmentList error:', error.message);
    throw new Error(error.message);
  }
  return (data as Equipment[]) || [];
}

export async function fetchEquipmentCategories(): Promise<EquipmentCategory[]> {
  const { data, error } = await getSupabaseClient()
    .from('equipment_categories')
    .select('*')
    .order('category_name');

  if (error) {
    console.error('Supabase fetchEquipmentCategories error:', error.message);
    throw new Error(error.message);
  }
  return (data as EquipmentCategory[]) || [];
}

export async function updateEquipmentStatus(
  equipmentId: string,
  newStatus: EquipmentStatus
): Promise<void> {
  const { data, error } = await getSupabaseClient()
    .from('equipment')
    .update({
      current_status: newStatus,
      updated_at: new Date().toISOString(),
    })
    .eq('id', equipmentId)
    .select('id')
    .maybeSingle();

  if (error) {
    console.error('Supabase updateEquipmentStatus error:', error.message);
    throw new Error(error.message);
  }

  if (!data) {
    throw new Error('Equipment status was not changed. Check your account permissions.');
  }
}

/* =========================================================================
   RENTAL ORDERS DIRECT SUPABASE QUERIES
   ========================================================================= */

export async function fetchRentalOrders(customerId?: string): Promise<RentalOrder[]> {
  let query = getSupabaseClient()
    .from('rental_orders')
    .select('*, items:rental_order_items(*, equipment(*)), customer:user_profiles!customer_id(*)')
    .order('created_at', { ascending: false });

  if (customerId) {
    query = query.eq('customer_id', customerId);
  }

  const { data, error } = await query;
  if (error) {
    console.error('Supabase fetchRentalOrders error:', error.message);
    throw new Error(error.message);
  }
  return (data as RentalOrder[]) || [];
}

export async function createRentalOrder(params: {
  customerId: string;
  equipmentId: string;
  unitDailyRate: number;
  dailyInsuranceRate: number;
  days: number;
  startDate: string;
  endDate: string;
  deliveryAddress: string;
  customerName?: string;
  customerPhone?: string;
}): Promise<RentalOrder> {
  const orderNumber = `ORD-${new Date().getFullYear()}-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
  const subtotal = Math.round(params.unitDailyRate * params.days * 100) / 100;
  const insurance = Math.round(params.dailyInsuranceRate * params.days * 100) / 100;
  const tax = Math.round((subtotal + insurance) * 0.08 * 100) / 100;
  const total = Math.round((subtotal + insurance + tax) * 100) / 100;

  const contactInfo =
    params.customerName || params.customerPhone
      ? `Contact: ${params.customerName || 'N/A'} (${params.customerPhone || 'N/A'})`
      : '';
  const specialTerms = contactInfo || null;

  // 1. Insert order header
  const { data: orderData, error: orderErr } = await getSupabaseClient()
    .from('rental_orders')
    .insert([
      {
        order_number: orderNumber,
        customer_id: params.customerId,
        status: 'draft',
        expected_start_date: params.startDate,
        expected_end_date: params.endDate,
        subtotal_amount: subtotal,
        insurance_amount: insurance,
        tax_amount: tax,
        security_deposit_amount: 0,
        total_amount: total,
        payment_status: 'unpaid',
        delivery_address: params.deliveryAddress,
        special_terms: specialTerms,
      },
    ])
    .select()
    .single();

  if (orderErr) {
    console.error('Supabase createRentalOrder error:', orderErr.message);
    throw new Error(orderErr.message);
  }

  // 2. Insert order child item
  const { error: itemErr } = await getSupabaseClient().from('rental_order_items').insert([
    {
      rental_order_id: orderData.id,
      equipment_id: params.equipmentId,
      unit_daily_rate: params.unitDailyRate,
      days_rented: params.days,
      daily_insurance_rate: params.dailyInsuranceRate,
      item_subtotal: subtotal,
      item_status: 'reserved',
    },
  ]);

  if (itemErr) {
    console.error('Supabase rental_order_items insert error:', itemErr.message);
    throw new Error(itemErr.message);
  }

  return orderData as RentalOrder;
}

export async function cancelRentalOrder(
  orderId: string,
  customerId?: string
): Promise<void> {
  let query = getSupabaseClient()
    .from('rental_orders')
    .update({
      status: 'cancelled',
      updated_at: new Date().toISOString(),
    })
    .eq('id', orderId)
    .eq('status', 'draft');

  if (customerId) {
    query = query.eq('customer_id', customerId);
  }

  const { data, error } = await query.select('id').maybeSingle();

  if (error) {
    console.error('Supabase cancelRentalOrder error:', error.message);
    throw new Error(error.message);
  }

  if (!data) {
    throw new Error(
      'Reservation could not be cancelled. Only pending reservations can be cancelled, or you may lack permission.'
    );
  }
}

export async function updateRentalOrderStatus(
  orderId: string,
  newStatus: RentalOrderStatus
): Promise<void> {
  const { data, error } = await getSupabaseClient()
    .from('rental_orders')
    .update({
      status: newStatus,
      updated_at: new Date().toISOString(),
    })
    .eq('id', orderId)
    .eq('status', 'draft')
    .select('id')
    .maybeSingle();

  if (error) {
    console.error('Supabase updateRentalOrderStatus error:', error.message);
    throw new Error(error.message);
  }

  if (!data) {
    throw new Error(
      'Reservation was not changed. It may no longer be pending, or your signed-in account does not have staff or admin permission.'
    );
  }
}

export async function executeRentalDispatch(
  orderId: string,
  staffId: string
): Promise<void> {
  const { data, error } = await getSupabaseClient().rpc('sp_process_rental_checkout', {
    p_order_id: orderId,
    p_staff_id: staffId,
  });
  if (error) {
    console.error('Supabase rental dispatch error:', error.message);
    throw new Error(error.message);
  }
  if (!data || typeof data !== 'object' || data.success !== true) {
    throw new Error('Supabase did not confirm the equipment dispatch.');
  }
}

export async function executeEquipmentReturn(params: {
  orderItemId: string;
  returnOdometer: number;
  fuelLevel: number;
  cleanliness: number;
  integrity: number;
  inspectorId: string;
  damageNotes?: string;
  penaltyFee?: number;
}): Promise<{ maintenanceCreated: boolean }> {
  const { data, error } = await getSupabaseClient().rpc('sp_process_equipment_return', {
    p_order_item_id: params.orderItemId,
    p_return_odometer: params.returnOdometer,
    p_fuel_level: params.fuelLevel,
    p_cleanliness: params.cleanliness,
    p_integrity: params.integrity,
    p_inspector_id: params.inspectorId,
    p_damage_notes: params.damageNotes ?? null,
    p_penalty_fee: params.penaltyFee ?? 0,
  });
  if (error) {
    console.error('Supabase return inspection error:', error.message);
    throw new Error(error.message);
  }
  if (!data || typeof data !== 'object' || data.success !== true) {
    throw new Error('Supabase did not confirm the return inspection.');
  }

  return { maintenanceCreated: data.maintenance_work_order_created === true };
}

/* =========================================================================
   MAINTENANCE DIRECT SUPABASE QUERIES
   ========================================================================= */

export async function fetchMaintenanceRecords(): Promise<MaintenanceRecord[]> {
  const { data, error } = await getSupabaseClient()
    .from('maintenance_records')
    .select('*, equipment(*)')
    .order('created_at', { ascending: false });

  if (error) {
    console.error('Supabase fetchMaintenanceRecords error:', error.message);
    throw new Error(error.message);
  }
  return (data as MaintenanceRecord[]) || [];
}

/* =========================================================================
   AUDIT LOGS DIRECT SUPABASE QUERIES
   ========================================================================= */

export async function fetchAuditLogs(): Promise<AuditLog[]> {
  const { data, error } = await getSupabaseClient()
    .from('audit_logs')
    .select('*')
    .order('executed_at', { ascending: false })
    .limit(50);

  if (error) {
    console.error('Supabase fetchAuditLogs error:', error.message);
    throw new Error(error.message);
  }
  return (data as AuditLog[]) || [];
}

/* =========================================================================
   AUTHENTICATION & PROFILE DIRECT SUPABASE QUERIES
   ========================================================================= */

export async function getCurrentUserProfile(): Promise<UserProfile | null> {
  const {
    data: { user },
    error: authError,
  } = await getSupabaseClient().auth.getUser();

  if (authError) {
    throw new Error(authError.message);
  }

  if (!user) {
    return null;
  }

  const { data: linkedProfile, error: linkedProfileError } = await getSupabaseClient()
    .from('user_profiles')
    .select('*')
    .eq('auth_user_id', user.id)
    .maybeSingle();

  if (linkedProfileError) {
    throw new Error(linkedProfileError.message);
  }

  if (linkedProfile) {
    return linkedProfile as UserProfile;
  }

  const { data: legacyProfile, error: legacyProfileError } = await getSupabaseClient()
    .from('user_profiles')
    .select('*')
    .eq('email', user.email ?? '')
    .maybeSingle();

  if (legacyProfileError) {
    throw new Error(legacyProfileError.message);
  }

  if (!legacyProfile || (legacyProfile.auth_user_id && legacyProfile.auth_user_id !== user.id)) {
    throw new Error('Your authenticated account does not have an EquipRent profile.');
  }

  return legacyProfile as UserProfile;
}

export async function loginWithEmail(
  email: string,
  pass: string
): Promise<{ profile: UserProfile }> {
  const { data: authData, error: authError } = await getSupabaseClient().auth.signInWithPassword({
    email,
    password: pass,
  });

  if (authError) {
    throw new Error(authError.message);
  }

  if (!authData.user) {
    throw new Error('Supabase did not return an authenticated user.');
  }

  const { data: linkedProfile, error: linkedProfileError } = await getSupabaseClient()
    .from('user_profiles')
    .select('*')
    .eq('auth_user_id', authData.user.id)
    .maybeSingle();

  if (linkedProfileError) {
    throw new Error(linkedProfileError.message);
  }

  let profileData = linkedProfile;
  if (!profileData) {
    const { data: legacyProfile, error: legacyProfileError } = await getSupabaseClient()
      .from('user_profiles')
      .select('*')
      .eq('email', authData.user.email ?? '')
      .maybeSingle();

    if (legacyProfileError) {
      throw new Error(legacyProfileError.message);
    }

    if (legacyProfile?.auth_user_id && legacyProfile.auth_user_id !== authData.user.id) {
      throw new Error('Authenticated account is not linked to this EquipRent profile.');
    }
    profileData = legacyProfile;
  }

  if (!profileData) {
    throw new Error('Authenticated account found, but no EquipRent profile is linked to it.');
  }

  return { profile: profileData as UserProfile };
}

export async function signUpWithProfile(params: {
  email: string;
  password: string;
  fullName: string;
  phone: string;
  companyName: string;
  requestedRole: UserRole;
}): Promise<{ profile?: UserProfile; message: string }> {
  const { data: authData, error: authError } = await getSupabaseClient().auth.signUp({
    email: params.email,
    password: params.password,
    options: {
      data: {
        full_name: params.fullName,
        phone: params.phone,
        company_name: params.companyName,
        requested_role: params.requestedRole,
      },
    },
  });

  if (authError) {
    throw new Error(authError.message);
  }

  if (!authData.user) {
    throw new Error('Supabase did not return a user after registration.');
  }

  if (!authData.session) {
    return {
      message: 'Account created. Confirm your email, then sign in.',
    };
  }

  const { data: profile, error: profileError } = await getSupabaseClient()
    .from('user_profiles')
    .select('*')
    .eq('auth_user_id', authData.user.id)
    .maybeSingle();

  if (profileError) {
    throw new Error(profileError.message);
  }

  if (!profile) {
    throw new Error(
      'Your account was created, but its EquipRent profile was not. Run the authentication setup SQL, then sign in again.'
    );
  }

  return {
    profile: profile as UserProfile,
    message:
      params.requestedRole === 'customer'
        ? 'Account successfully registered as a customer.'
        : `Account created as a customer. Your ${params.requestedRole} role request is awaiting administrator approval.`,
  };
}

export async function logoutUser(): Promise<void> {
  try {
    const { error } = await getSupabaseClient().auth.signOut();
    if (error) throw new Error(error.message);
  } catch (error: unknown) {
    console.error('Supabase logout error:', error);
    throw error;
  }
}

export async function updateUserProfile(params: {
  id: string;
  fullName: string;
  phone: string;
  companyName: string;
}): Promise<UserProfile> {
  const { data, error } = await getSupabaseClient()
    .from('user_profiles')
    .update({
      full_name: params.fullName,
      phone: params.phone,
      company_name: params.companyName,
      updated_at: new Date().toISOString(),
    })
    .eq('id', params.id)
    .select()
    .single();

  if (error) {
    throw new Error(error.message);
  }

  const updated = data as UserProfile;
  return updated;
}

/* =========================================================================
   WAREHOUSE & EQUIPMENT CRUD (ADMIN MANAGEMENT)
   ========================================================================= */

export async function fetchWarehouses(): Promise<WarehouseLocation[]> {
  const { data, error } = await getSupabaseClient()
    .from('warehouse_locations')
    .select('*')
    .order('branch_name');
  if (error) {
    console.error('Supabase fetchWarehouses error:', error.message);
    throw new Error(error.message);
  }
  return (data as WarehouseLocation[]) || [];
}

export async function createEquipment(params: {
  serial_number: string;
  model_name: string;
  manufacturer: string;
  model_year: number;
  category_id: string;
  warehouse_id: string;
  daily_rental_rate: number;
  replacement_value: number;
  operational_hours?: number;
  image_url?: string;
  maintenance_interval_hours?: number;
}): Promise<Equipment> {
  const { data, error } = await getSupabaseClient()
    .from('equipment')
    .insert([
      {
        serial_number: params.serial_number,
        model_name: params.model_name,
        manufacturer: params.manufacturer,
        model_year: params.model_year,
        category_id: params.category_id,
        warehouse_id: params.warehouse_id,
        daily_rental_rate: params.daily_rental_rate,
        replacement_value: params.replacement_value,
        operational_hours: params.operational_hours ?? 0,
        current_status: 'available',
        image_url: params.image_url || null,
        maintenance_interval_hours: params.maintenance_interval_hours ?? 250,
      },
    ])
    .select('*, category:equipment_categories(*)')
    .single();

  if (error) {
    console.error('Supabase createEquipment error:', error.message);
    throw new Error(error.message);
  }
  return data as Equipment;
}

export async function updateEquipmentDetails(
  id: string,
  updates: {
    model_name?: string;
    manufacturer?: string;
    category_id?: string;
    warehouse_id?: string;
    daily_rental_rate?: number;
    replacement_value?: number;
    current_status?: EquipmentStatus;
    image_url?: string;
  }
): Promise<Equipment> {
  const { data, error } = await getSupabaseClient()
    .from('equipment')
    .update({
      ...updates,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
    .select('*, category:equipment_categories(*)')
    .single();

  if (error) {
    console.error('Supabase updateEquipmentDetails error:', error.message);
    throw new Error(error.message);
  }
  return data as Equipment;
}

export async function deleteEquipment(id: string): Promise<void> {
  const { error } = await getSupabaseClient()
    .from('equipment')
    .delete()
    .eq('id', id);

  if (error) {
    console.error('Supabase deleteEquipment error:', error.message);
    throw new Error(error.message);
  }
}

/* =========================================================================
   USER MANAGEMENT (ADMIN OVERVIEW & STAFF PROVISIONING)
   ========================================================================= */

export async function fetchUserProfiles(): Promise<UserProfile[]> {
  const { data, error } = await getSupabaseClient()
    .from('user_profiles')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) {
    console.error('Supabase fetchUserProfiles error:', error.message);
    throw new Error(error.message);
  }
  return (data as UserProfile[]) || [];
}

export async function deleteUserProfile(userId: string): Promise<void> {
  const { error } = await getSupabaseClient()
    .from('user_profiles')
    .delete()
    .eq('id', userId);

  if (error) {
    console.error('Supabase deleteUserProfile error:', error.message);
    throw new Error(error.message);
  }
}

export async function addStaffMember(params: {
  fullName: string;
  email: string;
  phone: string;
  companyName?: string;
  password?: string;
}): Promise<UserProfile> {
  const tempPassword = params.password || 'StaffPass123!';

  // Try creating Auth user
  let authUserId: string | null = null;
  try {
    const { data: authData } = await getSupabaseClient().auth.signUp({
      email: params.email,
      password: tempPassword,
      options: {
        data: {
          full_name: params.fullName,
          phone: params.phone,
          company_name: params.companyName || 'EquipRent Operations',
          requested_role: 'staff',
        },
      },
    });
    authUserId = authData?.user?.id ?? null;
  } catch (authErr) {
    console.warn('Auth sign up notice (may already exist or admin API not enabled):', authErr);
  }

  const newProfileId = authUserId || crypto.randomUUID();
  const { data: profile, error: profileErr } = await getSupabaseClient()
    .from('user_profiles')
    .upsert(
      {
        id: newProfileId,
        auth_user_id: authUserId,
        full_name: params.fullName,
        email: params.email,
        phone: params.phone,
        company_name: params.companyName || 'EquipRent Operations',
        role: 'staff',
        requested_role: 'staff',
        account_status: 'active',
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'email' }
    )
    .select()
    .single();

  if (profileErr) {
    console.error('Supabase addStaffMember error:', profileErr.message);
    throw new Error(profileErr.message);
  }

  return profile as UserProfile;
}
