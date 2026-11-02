import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type {
  Equipment,
  EquipmentCategory,
  EquipmentBookedRange,
  WarehouseLocation,
  RentalOrder,
  RentalOrderItem,
  PaymentTransaction,
  PaymentMethod,
  EquipmentInspection,
  MaintenanceRecord,
  MaintenanceTask,
  MaintenanceType,
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

/**
 * Subscribe to live PostgreSQL changes across all public tables so any edit
 * (from another tab, another role, or directly in Supabase Table Editor) syncs immediately.
 */
export function subscribeToDatabaseSync(onChanged: () => void): () => void {
  if (!supabaseClient) return () => {};
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;

  const channel = supabaseClient
    .channel(`equiprent-live-sync-${crypto.randomUUID().slice(0, 6)}`)
    .on('postgres_changes', { event: '*', schema: 'public' }, () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        onChanged();
      }, 300);
    })
    .subscribe();

  return () => {
    if (debounceTimer) clearTimeout(debounceTimer);
    void supabaseClient.removeChannel(channel);
  };
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
  if (newStatus === 'available') {
    const { data: currentEquip } = await getSupabaseClient()
      .from('equipment')
      .select('current_status')
      .eq('id', equipmentId)
      .maybeSingle();

    if (currentEquip?.current_status === 'under_maintenance') {
      throw new Error(
        'This equipment is currently under maintenance. Mark it as Repaired in the Maintenance Queue to set it back to Available.'
      );
    }
    if (currentEquip?.current_status === 'rented') {
      throw new Error(
        'This equipment is currently rented out. Process its return in Return & Inspection first.'
      );
    }
  }

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

export async function fetchEquipmentBookedRanges(): Promise<EquipmentBookedRange[]> {
  const { data, error } = await getSupabaseClient().rpc('fn_get_equipment_booked_ranges');

  if (error) {
    console.warn(
      'Supabase fn_get_equipment_booked_ranges unavailable (run supabase/migrations/09_fix_rls_and_double_booking.sql):',
      error.message
    );
    return [];
  }

  return (data as EquipmentBookedRange[]) || [];
}

const ARCHIVED_REMOVED_USER_ORDER_TAG = '[Archived: Customer Account Removed]';

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
  return ((data as RentalOrder[]) || []).filter(
    (order) => order.special_terms !== ARCHIVED_REMOVED_USER_ORDER_TAG
  );
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
  initialStatus?: 'draft' | 'confirmed';
  authorizedStaffId?: string;
}): Promise<RentalOrder> {
  // Strict Past-Date Guard: Never allow booking on previous/past dates
  const nowLocal = new Date();
  const localToday = `${nowLocal.getFullYear()}-${String(nowLocal.getMonth() + 1).padStart(2, '0')}-${String(nowLocal.getDate()).padStart(2, '0')}`;
  if (!params.startDate || params.startDate < localToday || params.endDate < params.startDate) {
    throw new Error(
      'Cannot rent on previous/past dates. Please choose today or a future start date.'
    );
  }

  const orderStatus = params.initialStatus || 'draft';
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
        authorized_staff_id: params.authorizedStaffId || null,
        status: orderStatus,
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
    // Clean up the order header (or cancel if delete is restricted) so failed item inserts never leave orphan orders
    const { error: delErr } = await getSupabaseClient()
      .from('rental_orders')
      .delete()
      .eq('id', orderData.id);
    if (delErr) {
      await getSupabaseClient()
        .from('rental_orders')
        .update({ status: 'cancelled', updated_at: new Date().toISOString() })
        .eq('id', orderData.id);
    }

    if (itemErr.message.includes('Double-Booking Violation')) {
      throw new Error(
        'This equipment is already reserved or rented during your selected dates. Please choose open dates on the calendar.'
      );
    }
    if (itemErr.message.includes('Maintenance Conflict')) {
      throw new Error(
        'This equipment is scheduled for maintenance during your selected dates. Please choose different dates.'
      );
    }
    if (itemErr.message.toLowerCase().includes('row-level security')) {
      throw new Error(
        'Database RLS policy blocked rental_order_items insert. Run supabase/migrations/09_fix_rls_and_double_booking.sql in your Supabase SQL Editor.'
      );
    }
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

export async function recalculateAndSyncOrderTotals(orderId: string): Promise<void> {
  const client = getSupabaseClient();
  const { data: items } = await client
    .from('rental_order_items')
    .select('item_subtotal, daily_insurance_rate, days_rented')
    .eq('rental_order_id', orderId);

  const { data: ord } = await client
    .from('rental_orders')
    .select('security_deposit_amount')
    .eq('id', orderId)
    .maybeSingle();

  const subtotal =
    Math.round(
      (items || []).reduce((acc, i) => acc + Number(i.item_subtotal || 0), 0) * 100
    ) / 100;
  const insurance =
    Math.round(
      (items || []).reduce(
        (acc, i) => acc + Number(i.daily_insurance_rate || 0) * Number(i.days_rented || 0),
        0
      ) * 100
    ) / 100;
  const tax = Math.round((subtotal + insurance) * 0.08 * 100) / 100;
  const deposit = Number(ord?.security_deposit_amount || 0);
  const total = Math.round((subtotal + insurance + tax + deposit) * 100) / 100;

  await client
    .from('rental_orders')
    .update({
      subtotal_amount: subtotal,
      insurance_amount: insurance,
      tax_amount: tax,
      total_amount: total,
      updated_at: new Date().toISOString(),
    })
    .eq('id', orderId);
}

export async function addOrderItem(params: {
  orderId: string;
  equipmentId: string;
  unitDailyRate: number;
  dailyInsuranceRate: number;
  daysRented: number;
}): Promise<RentalOrderItem> {
  const safeRate = Math.round(Number(params.unitDailyRate) * 100) / 100;
  const safeDays = Math.max(1, Math.round(Number(params.daysRented)));
  const safeInsurance = Math.max(0, Math.round(Number(params.dailyInsuranceRate) * 100) / 100);
  const itemSubtotal = Math.round(safeRate * safeDays * 100) / 100;

  const { data, error } = await getSupabaseClient()
    .from('rental_order_items')
    .insert([
      {
        rental_order_id: params.orderId,
        equipment_id: params.equipmentId,
        unit_daily_rate: safeRate,
        days_rented: safeDays,
        daily_insurance_rate: safeInsurance,
        item_subtotal: itemSubtotal,
        item_status: 'reserved',
      },
    ])
    .select('*, equipment(*)')
    .single();

  if (error) {
    console.error('Supabase addOrderItem error:', error.message);
    if (error.message.includes('uq_order_equipment')) {
      throw new Error('This equipment unit is already listed on this order.');
    }
    if (error.message.includes('Double-Booking Violation')) {
      throw new Error(
        'This equipment is already reserved or rented during this order’s dates.'
      );
    }
    throw new Error(error.message);
  }

  await recalculateAndSyncOrderTotals(params.orderId);
  return data as RentalOrderItem;
}

export async function updateOrderItem(params: {
  itemId: string;
  orderId: string;
  unitDailyRate: number;
  daysRented: number;
  orderStartDate?: string;
}): Promise<void> {
  const safeRate = Math.round(Number(params.unitDailyRate) * 100) / 100;
  const safeDays = Math.max(1, Math.round(Number(params.daysRented)));
  if (!Number.isFinite(safeRate) || safeRate <= 0) {
    throw new Error('Daily rate must be greater than ₱0.');
  }

  const itemSubtotal = Math.round(safeRate * safeDays * 100) / 100;

  const { error } = await getSupabaseClient()
    .from('rental_order_items')
    .update({
      unit_daily_rate: safeRate,
      days_rented: safeDays,
      item_subtotal: itemSubtotal,
    })
    .eq('id', params.itemId);

  if (error) {
    console.error('Supabase updateOrderItem error:', error.message);
    throw new Error(error.message);
  }

  if (params.orderStartDate) {
    const [yr, mo, dy] = params.orderStartDate.split('-').map(Number);
    if (yr && mo && dy) {
      const endDt = new Date(yr, mo - 1, dy + (safeDays - 1));
      const newEndStr = `${endDt.getFullYear()}-${String(endDt.getMonth() + 1).padStart(2, '0')}-${String(endDt.getDate()).padStart(2, '0')}`;
      await getSupabaseClient()
        .from('rental_orders')
        .update({ expected_end_date: newEndStr, updated_at: new Date().toISOString() })
        .eq('id', params.orderId);
    }
  }

  await recalculateAndSyncOrderTotals(params.orderId);
}

export async function deleteOrderItem(params: {
  itemId: string;
  orderId: string;
}): Promise<{ orderDeletedOrCancelled: boolean }> {
  const client = getSupabaseClient();
  const { error } = await client
    .from('rental_order_items')
    .delete()
    .eq('id', params.itemId);

  if (error) {
    console.error('Supabase deleteOrderItem error:', error.message);
    throw new Error(error.message);
  }

  const { data: remaining } = await client
    .from('rental_order_items')
    .select('id')
    .eq('rental_order_id', params.orderId);

  if (!remaining || remaining.length === 0) {
    const { error: delOrdErr } = await client
      .from('rental_orders')
      .delete()
      .eq('id', params.orderId);

    if (delOrdErr) {
      await client
        .from('rental_orders')
        .update({
          status: 'cancelled',
          subtotal_amount: 0,
          insurance_amount: 0,
          tax_amount: 0,
          total_amount: 0,
          updated_at: new Date().toISOString(),
        })
        .eq('id', params.orderId);
    }
    return { orderDeletedOrCancelled: true };
  }

  await recalculateAndSyncOrderTotals(params.orderId);
  return { orderDeletedOrCancelled: false };
}

export async function rescheduleConfirmedOrderDates(
  orderId: string,
  newStartDate: string,
  newEndDate: string
): Promise<void> {
  const client = getSupabaseClient();
  const { data, error } = await client
    .from('rental_orders')
    .update({
      expected_start_date: newStartDate,
      expected_end_date: newEndDate,
      updated_at: new Date().toISOString(),
    })
    .eq('id', orderId)
    .in('status', ['draft', 'confirmed'])
    .select('id')
    .maybeSingle();

  if (error) {
    console.error('Supabase rescheduleConfirmedOrderDates error:', error.message);
    if (error.message.includes('Double-Booking Violation')) {
      throw new Error(
        `Cannot move order to ${newStartDate} – ${newEndDate}: another reservation already overlaps those dates.`
      );
    }
    throw new Error(error.message);
  }

  if (!data) {
    throw new Error('Could not reschedule order dates. Verify your staff/admin permissions.');
  }

  // Keep rental_order_items days_rented and item_subtotal in sync with the new date span
  const startMs = new Date(`${newStartDate}T00:00:00`).getTime();
  const endMs = new Date(`${newEndDate}T00:00:00`).getTime();
  const spanDays = Math.max(1, Math.round((endMs - startMs) / 86_400_000) + 1);

  const { data: orderItems } = await client
    .from('rental_order_items')
    .select('id, unit_daily_rate')
    .eq('rental_order_id', orderId);

  for (const item of orderItems || []) {
    const newSubtotal = Math.round(Number(item.unit_daily_rate) * spanDays * 100) / 100;
    await client
      .from('rental_order_items')
      .update({ days_rented: spanDays, item_subtotal: newSubtotal })
      .eq('id', item.id);
  }
  await recalculateAndSyncOrderTotals(orderId);
}

export async function staffCancelConfirmedOrder(orderId: string): Promise<void> {
  const { data, error } = await getSupabaseClient()
    .from('rental_orders')
    .update({
      status: 'cancelled',
      updated_at: new Date().toISOString(),
    })
    .eq('id', orderId)
    .in('status', ['draft', 'confirmed'])
    .select('id')
    .maybeSingle();

  if (error) {
    console.error('Supabase staffCancelConfirmedOrder error:', error.message);
    throw new Error(error.message);
  }

  if (!data) {
    throw new Error('Order could not be cancelled.');
  }
}

export async function fetchPaymentTransactions(): Promise<PaymentTransaction[]> {
  const { data, error } = await getSupabaseClient()
    .from('payment_transactions')
    .select('*')
    .order('processed_at', { ascending: false });

  if (error) {
    console.error('Supabase fetchPaymentTransactions error:', error.message);
    throw new Error(error.message);
  }
  return (data as PaymentTransaction[]) || [];
}

export async function recordOrderPayment(params: {
  orderId: string;
  amount: number;
  paymentMethod: PaymentMethod;
  processedBy?: string;
  notes?: string;
}): Promise<PaymentTransaction> {
  const safeAmount = Math.round(Number(params.amount) * 100) / 100;
  if (!Number.isFinite(safeAmount) || safeAmount <= 0) {
    throw new Error('Payment amount must be greater than ₱0.');
  }

  const client = getSupabaseClient();
  const txRef = `PAY-${new Date().getFullYear()}-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;

  const { data: txData, error: txErr } = await client
    .from('payment_transactions')
    .insert([
      {
        rental_order_id: params.orderId,
        transaction_reference: txRef,
        payment_method: params.paymentMethod,
        amount: safeAmount,
        transaction_status: 'succeeded',
        processed_by: params.processedBy || null,
        gateway_response: {
          channel: 'EquipRent Studio Desk',
          note: params.notes || 'Rental payment settled',
        },
      },
    ])
    .select()
    .single();

  if (txErr) {
    console.error('Supabase recordOrderPayment error:', txErr.message);
    throw new Error(txErr.message);
  }

  // Sync rental_orders.payment_status based on cumulative succeeded payments
  const { data: allTxs } = await client
    .from('payment_transactions')
    .select('amount, transaction_status')
    .eq('rental_order_id', params.orderId);

  const paidSum = (allTxs || [])
    .filter((t) => t.transaction_status === 'succeeded')
    .reduce((acc, t) => acc + Number(t.amount || 0), 0);

  const { data: ordRow } = await client
    .from('rental_orders')
    .select('total_amount')
    .eq('id', params.orderId)
    .maybeSingle();

  const orderTotal = Number(ordRow?.total_amount || 0);
  const nextPayStatus =
    paidSum + 0.01 >= orderTotal ? 'paid' : paidSum > 0 ? 'partially_paid' : 'unpaid';

  await client
    .from('rental_orders')
    .update({
      payment_status: nextPayStatus,
      updated_at: new Date().toISOString(),
    })
    .eq('id', params.orderId);

  return txData as PaymentTransaction;
}

export async function executeRentalDispatch(
  orderId: string,
  staffId: string,
  paymentMethod: PaymentMethod = 'cash'
): Promise<void> {
  const client = getSupabaseClient();
  const { data, error } = await client.rpc('sp_process_rental_checkout', {
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

  // Ensure payment_transactions & rental_orders.payment_status stay in sync on checkout
  const { data: ordRow } = await client
    .from('rental_orders')
    .select('total_amount, payment_status')
    .eq('id', orderId)
    .maybeSingle();

  if (ordRow && ordRow.payment_status === 'unpaid' && Number(ordRow.total_amount) > 0) {
    await recordOrderPayment({
      orderId,
      amount: Number(ordRow.total_amount),
      paymentMethod,
      processedBy: staffId,
      notes: 'Collected upon equipment dispatch & checkout',
    });
  }
}

export async function fetchEquipmentInspections(): Promise<EquipmentInspection[]> {
  const { data, error } = await getSupabaseClient()
    .from('equipment_inspections')
    .select('*, inspector:user_profiles!inspector_id(*)')
    .order('created_at', { ascending: false });

  if (error) {
    console.error('Supabase fetchEquipmentInspections error:', error.message);
    throw new Error(error.message);
  }
  return (data as EquipmentInspection[]) || [];
}

export async function executeEquipmentReturn(params: {
  orderItemId: string;
  orderId?: string;
  equipmentId?: string;
  condition: 'okay' | 'damaged';
  dispatchHours?: number | null;
  inspectorId: string;
  notes?: string;
  penaltyFee?: number;
}): Promise<{ maintenanceCreated: boolean }> {
  const client = getSupabaseClient();
  const isDamaged = params.condition === 'damaged';
  const safeHours = Math.max(0, Number(params.dispatchHours ?? 0));
  const safePenalty = isDamaged ? Math.max(0, Number(params.penaltyFee ?? 0)) : 0;
  const damageNoteText = isDamaged
    ? params.notes?.trim() || 'Returned damaged — requires maintenance check'
    : null;

  const { data, error } = await client.rpc('sp_process_equipment_return', {
    p_order_item_id: params.orderItemId,
    p_return_odometer: safeHours,
    p_fuel_level: 100,
    p_cleanliness: isDamaged ? 2 : 5,
    p_integrity: isDamaged ? 1 : 5,
    p_inspector_id: params.inspectorId,
    p_damage_notes: damageNoteText,
    p_penalty_fee: safePenalty,
  });

  if (error) {
    console.error('Supabase return inspection error:', error.message);
    throw new Error(error.message);
  }
  if (!data || typeof data !== 'object' || data.success !== true) {
    throw new Error('Supabase did not confirm the return inspection.');
  }

  const targetEquipmentId: string | undefined = params.equipmentId || data.equipment_id;
  if (targetEquipmentId) {
    // Guarantee the physical equipment status matches the chosen return condition
    await client
      .from('equipment')
      .update({
        current_status: isDamaged ? 'under_maintenance' : 'available',
        updated_at: new Date().toISOString(),
      })
      .eq('id', targetEquipmentId);
  }

  // Guarantee maintenance_records AND maintenance_tasks are both saved in DB when damaged!
  if (isDamaged && targetEquipmentId) {
    let maintId: string | null = data.maintenance_record_id || null;
    if (!maintId) {
      const { data: openMaint } = await client
        .from('maintenance_records')
        .select('id')
        .eq('equipment_id', targetEquipmentId)
        .in('maintenance_status', ['pending', 'in_progress'])
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      maintId = openMaint?.id ?? null;
    }

    if (!maintId) {
      const woNum = `WO-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${crypto.randomUUID().slice(0, 6).toUpperCase()}`;
      const { data: createdMaint } = await client
        .from('maintenance_records')
        .insert([
          {
            work_order_number: woNum,
            equipment_id: targetEquipmentId,
            maintenance_type: 'emergency_repair',
            maintenance_status: 'in_progress',
            scheduled_date: new Date().toISOString().slice(0, 10),
            odometer_hours_at_service: safeHours,
            lead_technician_id: params.inspectorId,
            service_description: `Post-return damage repair: ${damageNoteText}`,
          },
        ])
        .select('id')
        .single();
      maintId = createdMaint?.id ?? null;
    }

    if (maintId) {
      const { data: existingTasks } = await client
        .from('maintenance_tasks')
        .select('id')
        .eq('maintenance_id', maintId)
        .limit(1);

      if (!existingTasks || existingTasks.length === 0) {
        await client.from('maintenance_tasks').insert([
          {
            maintenance_id: maintId,
            technician_id: params.inspectorId,
            task_code: `TSK-DMG-${crypto.randomUUID().slice(0, 5).toUpperCase()}`,
            task_name: 'Post-Return Damage Inspection & Repair',
            hours_logged: 1,
            hourly_labor_rate: 500,
            progress_status: 'in_progress',
            findings_report: damageNoteText,
          },
        ]);
      }
    }
  }

  // If a damage penalty fee was assessed, also record it in payment_transactions
  if (isDamaged && safePenalty > 0 && params.orderId) {
    await recordOrderPayment({
      orderId: params.orderId,
      amount: safePenalty,
      paymentMethod: 'cash',
      processedBy: params.inspectorId,
      notes: `Post-return damage penalty fee (${damageNoteText || 'Damage assessment'})`,
    });
  }

  // Guarantee parent rental_order is marked 'completed' when no items remain 'dispatched'
  if (params.orderId) {
    const { data: stillOut } = await client
      .from('rental_order_items')
      .select('id')
      .eq('rental_order_id', params.orderId)
      .eq('item_status', 'dispatched');

    if (!stillOut || stillOut.length === 0) {
      const todayStr = new Date().toISOString().slice(0, 10);
      await client
        .from('rental_orders')
        .update({
          status: 'completed',
          actual_return_date: todayStr,
          updated_at: new Date().toISOString(),
        })
        .eq('id', params.orderId);
    }
  }

  return { maintenanceCreated: isDamaged || data.maintenance_work_order_created === true };
}

/* =========================================================================
   MAINTENANCE & MAINTENANCE TASKS DIRECT SUPABASE QUERIES
   ========================================================================= */

export async function fetchMaintenanceRecords(): Promise<MaintenanceRecord[]> {
  const { data, error } = await getSupabaseClient()
    .from('maintenance_records')
    .select('*, equipment(*), tasks:maintenance_tasks(*)')
    .order('created_at', { ascending: false });

  if (error) {
    console.error('Supabase fetchMaintenanceRecords error:', error.message);
    throw new Error(error.message);
  }
  return (data as MaintenanceRecord[]) || [];
}

async function syncMaintenanceRecordCosts(maintenanceId: string): Promise<void> {
  const client = getSupabaseClient();
  const { data: tasks } = await client
    .from('maintenance_tasks')
    .select('hours_logged, hourly_labor_rate')
    .eq('maintenance_id', maintenanceId);

  const { data: rec } = await client
    .from('maintenance_records')
    .select('parts_cost')
    .eq('id', maintenanceId)
    .maybeSingle();

  const laborCost =
    Math.round(
      (tasks || []).reduce(
        (acc, t) => acc + Number(t.hours_logged || 0) * Number(t.hourly_labor_rate || 0),
        0
      ) * 100
    ) / 100;
  const partsCost = Number(rec?.parts_cost || 0);
  const totalCost = Math.round((partsCost + laborCost) * 100) / 100;

  await client
    .from('maintenance_records')
    .update({
      labor_cost: laborCost,
      total_maintenance_cost: totalCost,
      updated_at: new Date().toISOString(),
    })
    .eq('id', maintenanceId);
}

export async function sendEquipmentToMaintenance(params: {
  equipmentId: string;
  technicianId: string;
  maintenanceType?: MaintenanceType;
  description: string;
  taskName?: string;
  hoursLogged?: number;
  hourlyLaborRate?: number;
}): Promise<MaintenanceRecord> {
  const client = getSupabaseClient();
  const todayStr = new Date().toISOString().slice(0, 10);
  const woNum = `WO-${todayStr.replace(/-/g, '')}-${crypto.randomUUID().slice(0, 6).toUpperCase()}`;
  const hours = Math.max(0.5, Number(params.hoursLogged ?? 1));
  const rate = Math.max(1, Number(params.hourlyLaborRate ?? 500));
  const laborCost = Math.round(hours * rate * 100) / 100;

  const { data: eqRow } = await client
    .from('equipment')
    .select('operational_hours, current_status')
    .eq('id', params.equipmentId)
    .maybeSingle();

  if (eqRow?.current_status === 'rented') {
    throw new Error(
      'Cannot send currently rented equipment to maintenance. Process its return first.'
    );
  }

  // 1. Set equipment to under_maintenance
  const { error: eqErr } = await client
    .from('equipment')
    .update({
      current_status: 'under_maintenance',
      updated_at: new Date().toISOString(),
    })
    .eq('id', params.equipmentId);

  if (eqErr) {
    throw new Error(eqErr.message);
  }

  // 2. Insert maintenance_records work order
  const { data: maintRec, error: maintErr } = await client
    .from('maintenance_records')
    .insert([
      {
        work_order_number: woNum,
        equipment_id: params.equipmentId,
        maintenance_type: params.maintenanceType || 'scheduled_routine',
        maintenance_status: 'in_progress',
        scheduled_date: todayStr,
        odometer_hours_at_service: Number(eqRow?.operational_hours ?? 0),
        parts_cost: 0,
        labor_cost: laborCost,
        total_maintenance_cost: laborCost,
        lead_technician_id: params.technicianId,
        service_description: params.description.trim() || 'Routine equipment calibration & check',
      },
    ])
    .select('*, equipment(*)')
    .single();

  if (maintErr) {
    throw new Error(maintErr.message);
  }

  // 3. Insert linked maintenance_tasks row so maintenance_tasks stays in 100% sync
  const { error: taskErr } = await client.from('maintenance_tasks').insert([
    {
      maintenance_id: maintRec.id,
      technician_id: params.technicianId,
      task_code: `TSK-${crypto.randomUUID().slice(0, 6).toUpperCase()}`,
      task_name: params.taskName?.trim() || 'Diagnostic Inspection & Calibration',
      hours_logged: hours,
      hourly_labor_rate: rate,
      progress_status: 'in_progress',
      findings_report: params.description.trim() || 'Scheduled inspection logged',
    },
  ]);

  if (taskErr) {
    console.warn('Supabase maintenance_tasks insert notice:', taskErr.message);
  }

  return maintRec as MaintenanceRecord;
}

export async function addMaintenanceTask(params: {
  maintenanceId: string;
  technicianId: string;
  taskName: string;
  hoursLogged: number;
  hourlyLaborRate: number;
  findingsReport?: string;
}): Promise<MaintenanceTask> {
  const safeHours = Math.max(0, Math.round(Number(params.hoursLogged) * 100) / 100);
  const safeRate = Math.max(1, Math.round(Number(params.hourlyLaborRate) * 100) / 100);

  const { data, error } = await getSupabaseClient()
    .from('maintenance_tasks')
    .insert([
      {
        maintenance_id: params.maintenanceId,
        technician_id: params.technicianId,
        task_code: `TSK-${crypto.randomUUID().slice(0, 6).toUpperCase()}`,
        task_name: params.taskName.trim(),
        hours_logged: safeHours,
        hourly_labor_rate: safeRate,
        progress_status: 'in_progress',
        findings_report: params.findingsReport?.trim() || null,
      },
    ])
    .select()
    .single();

  if (error) {
    console.error('Supabase addMaintenanceTask error:', error.message);
    throw new Error(error.message);
  }

  await syncMaintenanceRecordCosts(params.maintenanceId);
  return data as MaintenanceTask;
}

export async function deleteMaintenanceTask(params: {
  taskId: string;
  maintenanceId: string;
}): Promise<void> {
  const { error } = await getSupabaseClient()
    .from('maintenance_tasks')
    .delete()
    .eq('id', params.taskId);

  if (error) {
    console.error('Supabase deleteMaintenanceTask error:', error.message);
    throw new Error(error.message);
  }

  await syncMaintenanceRecordCosts(params.maintenanceId);
}

export async function completeMaintenanceRepair(params: {
  maintenanceId?: string;
  equipmentId: string;
  technicianId?: string;
}): Promise<void> {
  const client = getSupabaseClient();
  const todayStr = new Date().toISOString().slice(0, 10);
  const nowIso = new Date().toISOString();

  // Resolve open maintenance work order(s) for this equipment
  const targetMaintIds: string[] = [];
  if (params.maintenanceId) {
    targetMaintIds.push(params.maintenanceId);
  } else {
    const { data: openRecs } = await client
      .from('maintenance_records')
      .select('id')
      .eq('equipment_id', params.equipmentId)
      .in('maintenance_status', ['pending', 'in_progress']);
    for (const r of openRecs || []) {
      targetMaintIds.push(r.id);
    }
  }

  // Mark all linked maintenance_tasks as completed & sync labor/total costs
  for (const mId of targetMaintIds) {
    await client
      .from('maintenance_tasks')
      .update({
        progress_status: 'completed',
        sign_off_timestamp: nowIso,
      })
      .eq('maintenance_id', mId)
      .neq('progress_status', 'completed');

    await syncMaintenanceRecordCosts(mId);
  }

  if (params.maintenanceId) {
    const { error: rpcErr } = await client.rpc('sp_complete_maintenance_repair', {
      p_maintenance_id: params.maintenanceId,
    });

    if (rpcErr && !rpcErr.message.includes('sp_complete_maintenance_repair')) {
      console.error('Supabase sp_complete_maintenance_repair error:', rpcErr.message);
      throw new Error(rpcErr.message);
    }

    if (rpcErr) {
      const { error: maintErr } = await client
        .from('maintenance_records')
        .update({
          maintenance_status: 'completed',
          completed_date: todayStr,
          updated_at: nowIso,
        })
        .eq('id', params.maintenanceId);

      if (maintErr) {
        throw new Error(maintErr.message);
      }
    }
  } else {
    await client
      .from('maintenance_records')
      .update({
        maintenance_status: 'completed',
        completed_date: todayStr,
        updated_at: nowIso,
      })
      .eq('equipment_id', params.equipmentId)
      .in('maintenance_status', ['pending', 'in_progress']);
  }

  // Ensure the equipment unit is marked available immediately
  const { error: equipErr } = await client
    .from('equipment')
    .update({
      current_status: 'available',
      updated_at: nowIso,
    })
    .eq('id', params.equipmentId);

  if (equipErr) {
    throw new Error(equipErr.message);
  }
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
    if (linkedProfile.account_status === 'suspended') {
      await getSupabaseClient().auth.signOut();
      return null;
    }
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

  if (
    !legacyProfile ||
    legacyProfile.account_status === 'suspended' ||
    (legacyProfile.auth_user_id && legacyProfile.auth_user_id !== user.id)
  ) {
    await getSupabaseClient().auth.signOut();
    return null;
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
      await getSupabaseClient().auth.signOut();
      throw new Error('Authenticated account is not linked to this EquipRent profile.');
    }
    profileData = legacyProfile;
  }

  if (!profileData || profileData.account_status === 'suspended') {
    await getSupabaseClient().auth.signOut();
    throw new Error('This account has been removed by an administrator.');
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

export async function createEquipmentCategory(params: {
  category_name: string;
  category_code: string;
  description?: string;
  base_daily_insurance_rate: number;
}): Promise<EquipmentCategory> {
  const { data, error } = await getSupabaseClient()
    .from('equipment_categories')
    .insert([
      {
        category_name: params.category_name.trim(),
        category_code: params.category_code.trim().toUpperCase(),
        description: params.description?.trim() || null,
        base_daily_insurance_rate: Math.max(0, Number(params.base_daily_insurance_rate || 0)),
        requires_operator_certification: false,
      },
    ])
    .select()
    .single();

  if (error) {
    console.error('Supabase createEquipmentCategory error:', error.message);
    throw new Error(error.message);
  }
  return data as EquipmentCategory;
}

export async function deleteEquipmentCategory(id: string): Promise<void> {
  const { error } = await getSupabaseClient()
    .from('equipment_categories')
    .delete()
    .eq('id', id);

  if (error) {
    if (error.message.toLowerCase().includes('foreign key')) {
      throw new Error(
        'Cannot delete this category while equipment items are assigned to it. Reassign or remove those items first.'
      );
    }
    throw new Error(error.message);
  }
}

export async function createWarehouse(params: {
  branch_code: string;
  branch_name: string;
  address: string;
  city: string;
  region: string;
  contact_phone: string;
  max_storage_capacity?: number;
}): Promise<WarehouseLocation> {
  const { data, error } = await getSupabaseClient()
    .from('warehouse_locations')
    .insert([
      {
        branch_code: params.branch_code.trim().toUpperCase(),
        branch_name: params.branch_name.trim(),
        address: params.address.trim(),
        city: params.city.trim(),
        region: params.region.trim(),
        contact_phone: params.contact_phone.trim(),
        max_storage_capacity: Math.max(1, Number(params.max_storage_capacity || 100)),
      },
    ])
    .select()
    .single();

  if (error) {
    console.error('Supabase createWarehouse error:', error.message);
    throw new Error(error.message);
  }
  return data as WarehouseLocation;
}

export async function deleteWarehouse(id: string): Promise<void> {
  const { error } = await getSupabaseClient()
    .from('warehouse_locations')
    .delete()
    .eq('id', id);

  if (error) {
    if (error.message.toLowerCase().includes('foreign key')) {
      throw new Error(
        'Cannot delete this branch while equipment items are stored in it. Move or remove those items first.'
      );
    }
    throw new Error(error.message);
  }
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
  const client = getSupabaseClient();
  const { data, error } = await client
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

  // Keep pending ('draft') rental_order_items and rental_orders totals in sync when rate or category changes!
  const updatedEquip = data as Equipment;
  if (updates.daily_rental_rate !== undefined || updates.category_id !== undefined) {
    const newRate = Number(updatedEquip.daily_rental_rate);
    const newInsuranceRate = Number(updatedEquip.category?.base_daily_insurance_rate ?? 0);

    const { data: pendingItems } = await client
      .from('rental_order_items')
      .select('id, rental_order_id, days_rented, order:rental_orders!rental_order_id(status)')
      .eq('equipment_id', id)
      .eq('item_status', 'reserved');

    const affectedOrderIds = new Set<string>();
    for (const row of pendingItems || []) {
      const ordObj = Array.isArray(row.order) ? row.order[0] : row.order;
      if (ordObj && ordObj.status === 'draft') {
        const days = Math.max(1, Number(row.days_rented || 1));
        const nextSubtotal = Math.round(newRate * days * 100) / 100;
        await client
          .from('rental_order_items')
          .update({
            unit_daily_rate: newRate,
            daily_insurance_rate: newInsuranceRate,
            item_subtotal: nextSubtotal,
          })
          .eq('id', row.id);
        affectedOrderIds.add(row.rental_order_id);
      }
    }

    for (const ordId of affectedOrderIds) {
      await recalculateAndSyncOrderTotals(ordId);
    }
  }

  return updatedEquip;
}

export async function deleteEquipment(id: string): Promise<void> {
  const client = getSupabaseClient();

  // Clean up any items attached only to already-cancelled orders so cancelled test bookings don't block deletion
  const { data: linkedItems } = await client
    .from('rental_order_items')
    .select('id, rental_order_id, order:rental_orders!rental_order_id(status)')
    .eq('equipment_id', id);

  for (const li of linkedItems || []) {
    const ordObj = Array.isArray(li.order) ? li.order[0] : li.order;
    if (ordObj && ordObj.status === 'cancelled') {
      await client.from('rental_order_items').delete().eq('id', li.id);
    }
  }

  // Also remove completed/cancelled maintenance records if no active rental references remain
  const { data: remainingItems } = await client
    .from('rental_order_items')
    .select('id')
    .eq('equipment_id', id);

  if (!remainingItems || remainingItems.length === 0) {
    await client.from('maintenance_records').delete().eq('equipment_id', id);
  }

  const { error } = await client.from('equipment').delete().eq('id', id);

  if (error) {
    console.error('Supabase deleteEquipment error:', error.message);
    if (error.message.toLowerCase().includes('foreign key')) {
      throw new Error(
        'Cannot remove this equipment while it has active or completed rental order items. Remove it from active/draft orders first.'
      );
    }
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
    .neq('account_status', 'suspended')
    .order('created_at', { ascending: false });

  if (error) {
    console.error('Supabase fetchUserProfiles error:', error.message);
    throw new Error(error.message);
  }
  return (data as UserProfile[]) || [];
}

export async function deleteUserProfile(userId: string): Promise<void> {
  const client = getSupabaseClient();

  // 1. Primary path: Admin SECURITY DEFINER RPC (cascades linked orders/inspections in Migration 12)
  const { error: rpcError } = await client.rpc('sp_admin_delete_user_profile', {
    p_user_id: userId,
  });

  if (!rpcError) {
    return;
  }

  const isForeignKeyOrMissingRpc =
    rpcError.message.includes('linked rental orders or inspection records') ||
    rpcError.message.toLowerCase().includes('foreign key') ||
    rpcError.message.includes('sp_admin_delete_user_profile');

  if (!isForeignKeyOrMissingRpc) {
    console.error('Supabase sp_admin_delete_user_profile error:', rpcError.message);
    throw new Error(rpcError.message);
  }

  // 2. Automatic client-side cleanup when Migration 12 has not been run yet:
  //    Clean up all child records & foreign-key references, detach any historical order shells
  //    via Admin's pol_orders_staff_update policy, and re-invoke sp_admin_delete_user_profile
  //    so the user_profiles row is permanently deleted right away without needing SQL Editor steps.
  let adminProfileId = (await getCurrentUserProfile())?.id ?? null;
  if (!adminProfileId || adminProfileId === userId) {
    const { data: fallbackAdmin } = await client
      .from('user_profiles')
      .select('id')
      .eq('role', 'admin')
      .neq('id', userId)
      .limit(1)
      .maybeSingle();
    adminProfileId = fallbackAdmin?.id ?? null;
  }

  const { data: userOrders } = await client
    .from('rental_orders')
    .select('id, items:rental_order_items(id, equipment_id, item_status)')
    .eq('customer_id', userId);

  const orderIds = (userOrders || []).map((o) => o.id);
  if (orderIds.length > 0) {
    // Release any currently dispatched equipment back to available
    for (const ord of userOrders || []) {
      const items =
        (ord.items as Array<{ id: string; equipment_id: string; item_status: string }>) || [];
      for (const item of items) {
        if (item.item_status === 'dispatched') {
          await client
            .from('equipment')
            .update({ current_status: 'available', updated_at: new Date().toISOString() })
            .eq('id', item.equipment_id)
            .eq('current_status', 'rented');
        }
      }
    }

    await client.from('payment_transactions').delete().in('rental_order_id', orderIds);
    // Deleting rental_order_items also ON DELETE CASCADEs linked equipment_inspections
    await client.from('rental_order_items').delete().in('rental_order_id', orderIds);
    await client.from('rental_orders').delete().eq('customer_id', userId);

    // If pre-Migration-12 RLS lacks an Admin DELETE policy on rental_orders, detach the empty
    // order shells from userId using pol_orders_staff_update so zero FKs reference userId.
    if (adminProfileId && adminProfileId !== userId) {
      await client
        .from('rental_orders')
        .update({
          customer_id: adminProfileId,
          authorized_staff_id: null,
          status: 'cancelled',
          subtotal_amount: 0,
          insurance_amount: 0,
          tax_amount: 0,
          security_deposit_amount: 0,
          total_amount: 0,
          special_terms: ARCHIVED_REMOVED_USER_ORDER_TAG,
          updated_at: new Date().toISOString(),
        })
        .eq('customer_id', userId);
    }
  }

  // Delete RESTRICT child rows if removing a Staff member with past inspections/tasks
  await client.from('equipment_inspections').delete().eq('inspector_id', userId);
  await client.from('maintenance_tasks').delete().eq('technician_id', userId);

  // Clear nullable staff/manager references
  await client
    .from('rental_orders')
    .update({ authorized_staff_id: null })
    .eq('authorized_staff_id', userId);
  await client
    .from('payment_transactions')
    .update({ processed_by: null })
    .eq('processed_by', userId);
  await client
    .from('maintenance_records')
    .update({ lead_technician_id: null })
    .eq('lead_technician_id', userId);
  await client
    .from('warehouse_locations')
    .update({ manager_id: null })
    .eq('manager_id', userId);

  // 3. Re-run SECURITY DEFINER RPC now that all FK references to userId are cleared!
  const { error: retryRpcError } = await client.rpc('sp_admin_delete_user_profile', {
    p_user_id: userId,
  });

  if (!retryRpcError) {
    return;
  }

  // 4. Legacy pre-Migration-09 fallback: direct delete or suspend on user_profiles
  const { error: hardDeleteErr } = await client
    .from('user_profiles')
    .delete()
    .eq('id', userId);

  if (!hardDeleteErr) {
    return;
  }

  const { error: archiveErr } = await client
    .from('user_profiles')
    .update({
      account_status: 'suspended',
      auth_user_id: null,
      email: `removed-${userId.slice(0, 8)}-${Date.now()}@deleted.equiprent.local`,
      updated_at: new Date().toISOString(),
    })
    .eq('id', userId);

  if (archiveErr) {
    console.error(
      'Supabase deleteUserProfile error:',
      retryRpcError.message,
      archiveErr.message
    );
    throw new Error(retryRpcError.message || archiveErr.message);
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

  // Use an isolated, non-persisting Supabase client with an in-memory storage key so
  // signing up a staff account never overwrites or signs out the active Admin session.
  let authUserId: string | null = null;
  if (supabaseUrl && supabaseAnonKey) {
    try {
      const memoryStore = new Map<string, string>();
      const isolatedAuthClient = createClient(supabaseUrl, supabaseAnonKey, {
        auth: {
          storageKey: 'equiprent-admin-staff-provisioning',
          storage: {
            getItem: (key) => memoryStore.get(key) ?? null,
            setItem: (key, value) => {
              memoryStore.set(key, value);
            },
            removeItem: (key) => {
              memoryStore.delete(key);
            },
          },
          persistSession: false,
          autoRefreshToken: false,
          detectSessionInUrl: false,
        },
      });
      const { data: authData, error: signUpErr } = await isolatedAuthClient.auth.signUp({
        email: params.email,
        password: tempPassword,
        options: {
          data: {
            full_name: params.fullName,
            phone: params.phone,
            company_name: params.companyName || 'EquipRent Studio Operations',
            requested_role: 'staff',
          },
        },
      });
      if (signUpErr && !signUpErr.message.toLowerCase().includes('already registered')) {
        throw new Error(signUpErr.message);
      }
      authUserId = authData?.user?.id ?? null;
    } catch (authErr) {
      if (authErr instanceof Error && !authErr.message.toLowerCase().includes('already registered')) {
        throw authErr;
      }
      console.warn('Auth sign up notice (user may already exist):', authErr);
    }
  }

  // Promote/upsert staff profile via Admin SECURITY DEFINER RPC
  const { data: rpcProfile, error: rpcErr } = await getSupabaseClient().rpc(
    'sp_admin_upsert_staff_profile',
    {
      p_auth_user_id: authUserId,
      p_full_name: params.fullName,
      p_email: params.email,
      p_phone: params.phone,
      p_company_name: params.companyName || 'EquipRent Studio Operations',
    }
  );

  if (!rpcErr && rpcProfile) {
    return rpcProfile as UserProfile;
  }

  if (rpcErr && !rpcErr.message.includes('sp_admin_upsert_staff_profile')) {
    console.error('Supabase sp_admin_upsert_staff_profile error:', rpcErr.message);
    if (rpcErr.message.toLowerCase().includes('permission denied for table user_profiles')) {
      throw new Error(
        'Database permission error on user_profiles. Run supabase/migrations/10_fix_staff_return_maintenance_and_cameras.sql in your Supabase SQL Editor.'
      );
    }
    throw new Error(rpcErr.message);
  }

  const newProfileId = authUserId || crypto.randomUUID();
  const { data: profile, error: profileErr } = await getSupabaseClient()
    .from('user_profiles')
    .upsert(
      {
        id: newProfileId,
        auth_user_id: authUserId,
        full_name: params.fullName,
        email: params.email.trim().toLowerCase(),
        phone: params.phone,
        company_name: params.companyName || 'EquipRent Studio Operations',
        role: 'staff',
        requested_role: null,
        account_status: 'active',
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'email' }
    )
    .select()
    .single();

  if (profileErr) {
    console.error('Supabase addStaffMember error:', profileErr.message);
    if (profileErr.message.toLowerCase().includes('permission denied for table user_profiles')) {
      throw new Error(
        'Database permission error on user_profiles. Run supabase/migrations/10_fix_staff_return_maintenance_and_cameras.sql in your Supabase SQL Editor.'
      );
    }
    throw new Error(profileErr.message);
  }

  return profile as UserProfile;
}
