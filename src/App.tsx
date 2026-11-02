import { useEffect, useMemo, useState } from 'react';
import type {
  Equipment,
  EquipmentBookedRange,
  RentalOrder,
  PaymentTransaction,
  PaymentMethod,
  EquipmentInspection,
  MaintenanceRecord,
  MaintenanceTask,
  MaintenanceType,
  AuditLog,
  UserRole,
  UserProfile,
  EquipmentCategory,
  WarehouseLocation,
} from './types/database';
import {
  isSupabaseConfigured,
  subscribeToDatabaseSync,
  fetchEquipmentList,
  fetchEquipmentCategories,
  createEquipmentCategory,
  deleteEquipmentCategory,
  fetchEquipmentBookedRanges,
  fetchWarehouses,
  createWarehouse,
  deleteWarehouse,
  createEquipment,
  updateEquipmentDetails,
  deleteEquipment,
  fetchRentalOrders,
  createRentalOrder,
  addOrderItem,
  updateOrderItem,
  deleteOrderItem,
  cancelRentalOrder,
  updateRentalOrderStatus,
  rescheduleConfirmedOrderDates,
  staffCancelConfirmedOrder,
  fetchPaymentTransactions,
  recordOrderPayment,
  executeRentalDispatch,
  fetchEquipmentInspections,
  executeEquipmentReturn,
  fetchMaintenanceRecords,
  sendEquipmentToMaintenance,
  addMaintenanceTask,
  deleteMaintenanceTask,
  completeMaintenanceRepair,
  fetchAuditLogs,
  fetchUserProfiles,
  deleteUserProfile,
  addStaffMember,
  getCurrentUserProfile,
  logoutUser,
  updateUserProfile,
} from './lib/supabase';
import { AuthScreen } from './components/AuthScreen';
import { LoadingScreen } from './components/LoadingScreen';
import { formatPHP, formatPhilippinePhone, getOrderTotal } from './lib/formatters';

const toDateInputValue = (date: Date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const addDaysToDateStr = (dateStr: string, daysToAdd: number): string => {
  const [year, month, day] = dateStr.split('-').map(Number);
  if (!year || !month || !day) return dateStr;
  return toDateInputValue(new Date(year, month - 1, day + daysToAdd));
};

const formatOrderEquipmentLabel = (ord: RentalOrder): string => {
  const items = ord.items || [];
  if (items.length === 0) return 'Equipment';
  if (items.length === 1) return items[0]?.equipment?.model_name || 'Equipment';
  const first = items[0]?.equipment?.model_name || 'Equipment';
  return `${first} +${items.length - 1} more (${items.length} items)`;
};

export default function App() {
  // Authentication & Session State from Supabase
  const [currentUser, setCurrentUser] = useState<UserProfile | null>(null);
  const [authChecking, setAuthChecking] = useState(true);
  const [dashboardDataLoaded, setDashboardDataLoaded] = useState(false);

  // User role is strictly bound to authenticated Supabase user profile
  const currentRole: UserRole = currentUser?.role || 'customer';

  useEffect(() => {
    getCurrentUserProfile()
      .then((profile) => {
        if (profile) {
          setCurrentUser(profile);
        }
        setAuthChecking(false);
      })
      .catch((error: unknown) => {
        console.error('Could not restore Supabase session:', error);
        setAuthChecking(false);
      });
  }, []);

  const handleLogout = async () => {
    try {
      await logoutUser();
      setCurrentUser(null);
      setDashboardDataLoaded(false);
      setActiveTab('Dashboard');
      showToast('Signed out of session.');
    } catch (error: unknown) {
      showToast(error instanceof Error ? error.message : 'Could not sign out.');
    }
  };

  // Active navigation tab
  const [activeTab, setActiveTab] = useState('Dashboard');
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('All equipment');
  const [maxPrice, setMaxPrice] = useState<number | null>(null);
  const [toast, setToast] = useState('');
  const [reservationUpdating, setReservationUpdating] = useState(false);
  const [dataLoadError, setDataLoadError] = useState('');

  // Domain data states
  const [equipmentList, setEquipmentList] = useState<Equipment[]>([]);
  const [categoriesList, setCategoriesList] = useState<EquipmentCategory[]>([]);
  const [warehousesList, setWarehousesList] = useState<WarehouseLocation[]>([]);
  const [orders, setOrders] = useState<RentalOrder[]>([]);
  const [payments, setPayments] = useState<PaymentTransaction[]>([]);
  const [inspections, setInspections] = useState<EquipmentInspection[]>([]);
  const [bookedRanges, setBookedRanges] = useState<EquipmentBookedRange[]>([]);
  const [maintenance, setMaintenance] = useState<MaintenanceRecord[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);
  const [usersList, setUsersList] = useState<UserProfile[]>([]);

  // Reservation modal states
  const [rentingEquipment, setRentingEquipment] = useState<Equipment | null>(null);
  const [returningItemId, setReturningItemId] = useState<string | null>(null);

  // Booking form state with Name & Contact Number & Future Date validation
  const todayDate = toDateInputValue(new Date());
  const [bookSelectedCustomerId, setBookSelectedCustomerId] = useState('');
  const [bookCustomerName, setBookCustomerName] = useState('');
  const [bookCustomerPhone, setBookCustomerPhone] = useState('');
  const [bookDays, setBookDays] = useState('');
  const [bookStartDate, setBookStartDate] = useState(todayDate);
  const [bookAddress, setBookAddress] = useState('');

  // Availability Calendar state
  const [calEquipId, setCalEquipId] = useState<string>('');
  const [calSelectedDate, setCalSelectedDate] = useState<string>(todayDate);
  const [calendarMonth, setCalendarMonth] = useState(
    () => new Date(new Date().getFullYear(), new Date().getMonth(), 1)
  );

  // Customer Profile Form state
  const [profileName, setProfileName] = useState('');
  const [profilePhone, setProfilePhone] = useState('');
  const [profileCompany, setProfileCompany] = useState('');
  const [profileSaving, setProfileSaving] = useState(false);

  // Return inspection form state
  const [returnCondition, setReturnCondition] = useState<'okay' | 'damaged'>('okay');
  const [damageNotes, setDamageNotes] = useState<string>('');
  const [penaltyFee, setPenaltyFee] = useState('');
  const [returnPhysicallyReceived, setReturnPhysicallyReceived] = useState(false);
  const [maintenanceUpdatingId, setMaintenanceUpdatingId] = useState<string | null>(null);

  // Staff merged orders & requests filters
  const [staffOrderFilter, setStaffOrderFilter] = useState<
    'all' | 'draft' | 'confirmed' | 'in_progress' | 'completed' | 'cancelled'
  >('all');
  const [staffOrderSearch, setStaffOrderSearch] = useState('');

  // Admin Equipment CRUD modal state
  const [isAddEquipmentOpen, setIsAddEquipmentOpen] = useState(false);
  const [editingEquipment, setEditingEquipment] = useState<Equipment | null>(null);
  const [eqSerialNumber, setEqSerialNumber] = useState('');
  const [eqModelName, setEqModelName] = useState('');
  const [eqManufacturer, setEqManufacturer] = useState('');
  const [eqModelYear, setEqModelYear] = useState('2024');
  const [eqCategoryId, setEqCategoryId] = useState('');
  const [eqWarehouseId, setEqWarehouseId] = useState('');
  const [eqDailyRate, setEqDailyRate] = useState('');
  const [eqReplacementVal, setEqReplacementVal] = useState('');
  const [eqImageUrl, setEqImageUrl] = useState('');

  // Admin Staff creation modal state
  const [isAddStaffOpen, setIsAddStaffOpen] = useState(false);
  const [staffFullName, setStaffFullName] = useState('');
  const [staffEmail, setStaffEmail] = useState('');
  const [staffPhone, setStaffPhone] = useState('');
  const [staffPassword, setStaffPassword] = useState('');
  const [staffSaving, setStaffSaving] = useState(false);

  // Admin User & Borrowed filters
  const [adminUserTab, setAdminUserTab] = useState<'staff' | 'customer'>('staff');
  const [adminBorrowedTab, setAdminBorrowedTab] = useState<'borrowed' | 'returned' | 'orders'>('borrowed');
  const [userSearch, setUserSearch] = useState('');

  // Order Items CRUD modal state (syncs rental_order_items <-> rental_orders)
  const [managingOrderId, setManagingOrderId] = useState<string | null>(null);
  const [itemEditDrafts, setItemEditDrafts] = useState<
    Record<string, { rate: string; days: string }>
  >({});
  const [newOrderItemEquipId, setNewOrderItemEquipId] = useState('');
  const [newOrderItemDays, setNewOrderItemDays] = useState('1');
  const [newOrderItemRate, setNewOrderItemRate] = useState('');
  const [orderItemSaving, setOrderItemSaving] = useState(false);

  // Payment Transaction modal state (syncs payment_transactions <-> rental_orders.payment_status)
  const [payingOrder, setPayingOrder] = useState<RentalOrder | null>(null);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('cash');
  const [paymentAmount, setPaymentAmount] = useState('');
  const [paymentSaving, setPaymentSaving] = useState(false);

  // Send to Maintenance & Maintenance Tasks modal state (syncs equipment + maintenance_records + maintenance_tasks)
  const [maintTargetEquip, setMaintTargetEquip] = useState<Equipment | null>(null);
  const [maintType, setMaintType] = useState<MaintenanceType>('scheduled_routine');
  const [maintDesc, setMaintDesc] = useState('');
  const [maintTaskName, setMaintTaskName] = useState('Diagnostic Inspection & Calibration');
  const [maintHours, setMaintHours] = useState('1');
  const [maintHourlyRate, setMaintHourlyRate] = useState('500');
  const [maintSaving, setMaintSaving] = useState(false);

  const [managingMaintId, setManagingMaintId] = useState<string | null>(null);
  const [newTaskName, setNewTaskName] = useState('');
  const [newTaskHours, setNewTaskHours] = useState('1');
  const [newTaskRate, setNewTaskRate] = useState('500');
  const [newTaskReport, setNewTaskReport] = useState('');
  const [taskSaving, setTaskSaving] = useState(false);

  // Admin Categories & Studio Branches CRUD modals (equipment_categories & warehouse_locations)
  const [isManageCategoriesOpen, setIsManageCategoriesOpen] = useState(false);
  const [catName, setCatName] = useState('');
  const [catCode, setCatCode] = useState('');
  const [catDesc, setCatDesc] = useState('');
  const [catInsuranceRate, setCatInsuranceRate] = useState('150');

  const [isManageWarehousesOpen, setIsManageWarehousesOpen] = useState(false);
  const [whCode, setWhCode] = useState('');
  const [whName, setWhName] = useState('');
  const [whAddress, setWhAddress] = useState('');
  const [whCity, setWhCity] = useState('Quezon City');
  const [whRegion, setWhRegion] = useState('NCR');
  const [whPhone, setWhPhone] = useState('+63 917 555 0100');
  const [whCapacity, setWhCapacity] = useState('150');

  // Sync profile form when user changes
  useEffect(() => {
    if (currentUser) {
      setProfileName(currentUser.full_name);
      setProfilePhone(currentUser.phone);
      setProfileCompany(currentUser.company_name || '');
      setBookCustomerName(currentUser.full_name);
      setBookCustomerPhone(currentUser.phone);
    }
  }, [currentUser]);

  // Load all database entities directly from Supabase
  const reloadData = async () => {
    if (!currentUser) return;
    try {
      const [eq, cats, whs, ord, pays, insps, ranges, maint, logs, users] = await Promise.all([
        fetchEquipmentList(),
        fetchEquipmentCategories().catch(() => []),
        fetchWarehouses().catch(() => []),
        fetchRentalOrders(currentRole === 'customer' ? currentUser.id : undefined),
        fetchPaymentTransactions().catch(() => []),
        currentRole === 'customer'
          ? Promise.resolve([])
          : fetchEquipmentInspections().catch(() => []),
        fetchEquipmentBookedRanges().catch(() => []),
        currentRole === 'customer' ? Promise.resolve([]) : fetchMaintenanceRecords(),
        currentRole === 'admin' ? fetchAuditLogs().catch(() => []) : Promise.resolve([]),
        currentRole === 'admin' || currentRole === 'staff'
          ? fetchUserProfiles().catch(() => [])
          : Promise.resolve([]),
      ]);
      setEquipmentList(eq);
      setCategoriesList(cats);
      setWarehousesList(whs);
      if (eq.length > 0 && !calEquipId) {
        setCalEquipId(eq[0].id);
      }
      setOrders(ord);
      setPayments(pays);
      setInspections(insps);
      setBookedRanges(ranges);
      setMaintenance(maint);
      setAuditLogs(logs);
      setUsersList(users);
      setDataLoadError('');
    } catch (e: unknown) {
      console.error('Supabase reloadData error:', e);
      setDataLoadError(e instanceof Error ? e.message : 'Could not load data from Supabase.');
    } finally {
      setDashboardDataLoaded(true);
    }
  };

  useEffect(() => {
    if (!currentUser) return;
    void reloadData();
    // Live Realtime subscription so database edits anywhere immediately sync UI state
    const unsubscribe = subscribeToDatabaseSync(() => {
      void reloadData();
    });
    return () => unsubscribe();
  }, [currentUser]);

  // Computed live metrics from Supabase database
  const totalFleet = equipmentList.length;
  const maximumDailyRate = Math.max(...equipmentList.map((item) => item.daily_rental_rate), 0);
  const availableEquipment = useMemo(
    () => equipmentList.filter((e) => e.current_status === 'available'),
    [equipmentList]
  );
  const rentedEquipment = useMemo(
    () => equipmentList.filter((e) => e.current_status === 'rented'),
    [equipmentList]
  );
  const maintenanceEquipment = useMemo(
    () => equipmentList.filter((e) => e.current_status === 'under_maintenance'),
    [equipmentList]
  );

  const totalFleetValuation = useMemo(() => {
    return equipmentList.reduce((acc, e) => acc + e.replacement_value, 0);
  }, [equipmentList]);

  const totalRentalRevenue = useMemo(() => {
    return orders
      .filter((o) => o.status !== 'cancelled')
      .reduce((acc, o) => acc + getOrderTotal(o), 0);
  }, [orders]);

  const activeContracts = useMemo(() => {
    return orders.filter((o) => o.status === 'in_progress' || o.status === 'confirmed');
  }, [orders]);

  const pendingRequests = useMemo(() => {
    return orders.filter((o) => o.status === 'draft');
  }, [orders]);

  // Live Borrowed Items (Items currently dispatched / out on rent)
  const borrowedItems = useMemo(() => {
    const list: Array<{
      orderId: string;
      orderNumber: string;
      itemId: string;
      equipmentName: string;
      serialNumber: string;
      customerName: string;
      customerPhone: string;
      startDate: string;
      endDate: string;
      deliveryAddress: string;
      status: string;
    }> = [];

    orders.forEach((ord) => {
      if (ord.status === 'in_progress' || ord.status === 'confirmed') {
        ord.items?.forEach((item) => {
          if (item.item_status === 'dispatched' || item.item_status === 'reserved') {
            list.push({
              orderId: ord.id,
              orderNumber: ord.order_number,
              itemId: item.id,
              equipmentName: item.equipment?.model_name || 'Equipment',
              serialNumber: item.equipment?.serial_number || 'N/A',
              customerName: ord.customer?.full_name || 'Customer',
              customerPhone: ord.customer?.phone || 'N/A',
              startDate: ord.expected_start_date,
              endDate: ord.expected_end_date,
              deliveryAddress: ord.delivery_address || 'Studio Pickup',
              status: item.item_status,
            });
          }
        });
      }
    });
    return list;
  }, [orders]);

  // Return & Inspection rows (only dispatched items out with customers + returned/damaged history)
  const returnableOrderItems = useMemo(() => {
    const rows: Array<{
      orderId: string;
      orderNumber: string;
      customerName: string;
      customerPhone: string;
      startDate: string;
      endDate: string;
      itemId: string;
      equipmentId: string;
      equipmentName: string;
      serialNumber: string;
      itemStatus: string;
      dispatchHours: number | null;
      conditionNotes?: string | null;
    }> = [];

    orders.forEach((ord) => {
      ord.items?.forEach((item) => {
        if (
          item.item_status === 'dispatched' ||
          item.item_status === 'returned' ||
          item.item_status === 'damaged'
        ) {
          rows.push({
            orderId: ord.id,
            orderNumber: ord.order_number,
            customerName: ord.customer?.full_name || 'Customer',
            customerPhone: ord.customer?.phone || '',
            startDate: ord.expected_start_date,
            endDate: ord.expected_end_date,
            itemId: item.id,
            equipmentId: item.equipment_id,
            equipmentName: item.equipment?.model_name || 'Equipment',
            serialNumber: item.equipment?.serial_number || '—',
            itemStatus: item.item_status,
            dispatchHours: item.dispatch_odometer_hours ?? null,
            conditionNotes: item.condition_notes,
          });
        }
      });
    });

    // Sort active 'dispatched' items first so Staff sees items awaiting return at the top
    return rows.sort((a, b) => {
      if (a.itemStatus === 'dispatched' && b.itemStatus !== 'dispatched') return -1;
      if (a.itemStatus !== 'dispatched' && b.itemStatus === 'dispatched') return 1;
      return 0;
    });
  }, [orders]);

  // Unified Maintenance Queue: combines maintenance_records (with joined maintenance_tasks) + any equipment marked under_maintenance
  const maintenanceQueueItems = useMemo(() => {
    const openEquipmentIds = new Set<string>();
    const rows: Array<{
      key: string;
      maintenanceId?: string;
      workOrderNumber: string;
      equipmentId: string;
      equipmentName: string;
      serialNumber: string;
      maintenanceType: string;
      notes: string;
      scheduledDate: string;
      totalCost: number;
      tasks: MaintenanceTask[];
      status: 'pending' | 'in_progress' | 'completed' | 'cancelled';
    }> = [];

    for (const m of maintenance) {
      if (m.maintenance_status === 'pending' || m.maintenance_status === 'in_progress') {
        openEquipmentIds.add(m.equipment_id);
      }
      const matchedEquip = equipmentList.find((e) => e.id === m.equipment_id) || m.equipment;
      rows.push({
        key: m.id,
        maintenanceId: m.id,
        workOrderNumber: m.work_order_number,
        equipmentId: m.equipment_id,
        equipmentName: matchedEquip?.model_name || 'Equipment',
        serialNumber: matchedEquip?.serial_number || '—',
        maintenanceType: m.maintenance_type,
        notes: m.service_description || 'Inspection / repair required',
        scheduledDate: m.scheduled_date,
        totalCost: Number(m.total_maintenance_cost || 0),
        tasks: m.tasks || [],
        status: m.maintenance_status,
      });
    }

    // Also surface any equipment unit currently set to 'under_maintenance' without an open work order
    for (const eq of equipmentList) {
      if (eq.current_status === 'under_maintenance' && !openEquipmentIds.has(eq.id)) {
        rows.unshift({
          key: `eq-maint-${eq.id}`,
          maintenanceId: undefined,
          workOrderNumber: 'MANUAL-MAINT',
          equipmentId: eq.id,
          equipmentName: eq.model_name,
          serialNumber: eq.serial_number,
          maintenanceType: 'scheduled_routine',
          notes: 'Marked Under Maintenance — ready to verify & restore',
          scheduledDate: todayDate,
          totalCost: 0,
          tasks: [],
          status: 'pending',
        });
      }
    }

    // Keep open repairs on top, completed below
    return rows.sort((a, b) => {
      const aOpen = a.status === 'pending' || a.status === 'in_progress' ? 0 : 1;
      const bOpen = b.status === 'pending' || b.status === 'in_progress' ? 0 : 1;
      return aOpen - bOpen;
    });
  }, [maintenance, equipmentList, todayDate]);

  const activeMaintenanceCount = useMemo(
    () =>
      maintenanceQueueItems.filter(
        (m) => m.status === 'pending' || m.status === 'in_progress'
      ).length,
    [maintenanceQueueItems]
  );

  const activeDispatchedCount = useMemo(
    () => returnableOrderItems.filter((r) => r.itemStatus === 'dispatched').length,
    [returnableOrderItems]
  );

  // Returned Items tracking
  const returnedItems = useMemo(() => {
    const list: Array<{
      orderId: string;
      orderNumber: string;
      itemId: string;
      equipmentName: string;
      serialNumber: string;
      customerName: string;
      returnDate: string;
      hours: number | null;
      status: string;
    }> = [];

    orders.forEach((ord) => {
      ord.items?.forEach((item) => {
        if (item.item_status === 'returned' || item.item_status === 'damaged') {
          list.push({
            orderId: ord.id,
            orderNumber: ord.order_number,
            itemId: item.id,
            equipmentName: item.equipment?.model_name || 'Equipment',
            serialNumber: item.equipment?.serial_number || 'N/A',
            customerName: ord.customer?.full_name || 'Customer',
            returnDate: item.returned_at ? item.returned_at.slice(0, 10) : ord.expected_end_date,
            hours: item.return_odometer_hours ?? null,
            status: item.item_status,
          });
        }
      });
    });
    return list;
  }, [orders]);

  // Dynamic Category map
  const categoriesMap = useMemo(() => {
    const map: Record<string, { total: number; available: number; rented: number }> = {};
    for (const item of equipmentList) {
      const cat = item.category?.category_name || 'Uncategorized';
      if (!map[cat]) map[cat] = { total: 0, available: 0, rented: 0 };
      map[cat].total += 1;
      if (item.current_status === 'available') map[cat].available += 1;
      if (item.current_status === 'rented') map[cat].rented += 1;
    }
    return map;
  }, [equipmentList]);

  // Tab definitions customized by Tier (Admin, Staff, Customer)
  const navTabs = useMemo(() => {
    if (currentRole === 'customer') {
      return [
        { label: 'Dashboard' },
        { label: 'Browse Equipment' },
        { label: 'Availability Calendar' },
        { label: 'My Reservations', badge: orders.length ? String(orders.length) : undefined },
        { label: 'My Profile' },
      ];
    }
    if (currentRole === 'staff') {
      const pendingReviewCount = orders.filter((o) => o.status === 'draft').length;
      const readyDispatchCount = orders.filter((o) => o.status === 'confirmed').length;
      return [
        { label: 'Dashboard' },
        { label: 'Fleet Inventory' },
        {
          label: 'Orders & Requests',
          badge: pendingReviewCount ? String(pendingReviewCount) : undefined,
        },
        {
          label: 'Dispatch & Checkout',
          badge: readyDispatchCount ? String(readyDispatchCount) : undefined,
        },
        {
          label: 'Return & Inspection',
          badge: activeDispatchedCount ? String(activeDispatchedCount) : undefined,
        },
        {
          label: 'Maintenance Queue',
          badge: activeMaintenanceCount ? String(activeMaintenanceCount) : undefined,
        },
        { label: 'My Profile' },
      ];
    }
    // Admin: Overview, Fleet CRUD, Borrowed & Returned, User Management, Audit Logs, Profile
    return [
      { label: 'Dashboard' },
      { label: 'Fleet Inventory' },
      { label: 'Borrowed & Returned Items' },
      { label: 'User Management' },
      {
        label: 'Maintenance Oversight',
        badge: activeMaintenanceCount ? String(activeMaintenanceCount) : undefined,
      },
      { label: 'Engine Audit Logs', badge: auditLogs.length ? String(auditLogs.length) : undefined },
      { label: 'My Profile' },
    ];
  }, [currentRole, orders, activeDispatchedCount, activeMaintenanceCount, auditLogs.length]);

  // Enforce strict role-based page/tab isolation so accounts can never view unauthorized pages
  useEffect(() => {
    const allowedTabs = new Set(navTabs.map((t) => t.label));
    // Staff and Admin may also inspect the read-only Availability Calendar from Fleet Inventory
    if (currentRole === 'staff' || currentRole === 'admin') {
      allowedTabs.add('Availability Calendar');
    }
    if (!allowedTabs.has(activeTab)) {
      setActiveTab('Dashboard');
    }
  }, [activeTab, currentRole, navTabs]);

  // Privacy-safe cross-account availability lookup (uses anonymized bookedRanges + local state)
  const getEquipmentBlockOnDate = (
    equipmentId: string,
    date: string
  ): 'rented' | 'reserved' | 'maintenance' | null => {
    for (const range of bookedRanges) {
      if (range.equipment_id === equipmentId && range.start_date <= date && date <= range.end_date) {
        return range.block_type;
      }
    }
    const maintMatch = maintenance.some(
      (record) =>
        record.equipment_id === equipmentId &&
        record.scheduled_date === date &&
        record.maintenance_status !== 'completed' &&
        record.maintenance_status !== 'cancelled'
    );
    if (maintMatch) return 'maintenance';

    const orderMatch = orders.find(
      (order) =>
        order.status !== 'cancelled' &&
        order.status !== 'completed' &&
        order.items?.some((item) => item.equipment_id === equipmentId) &&
        order.expected_start_date <= date &&
        date <= order.expected_end_date
    );
    if (orderMatch) {
      return orderMatch.status === 'in_progress' ? 'rented' : 'reserved';
    }
    return null;
  };

  const doesRangeOverlapBooking = (
    equipmentId: string,
    startDate: string,
    endDate: string
  ): 'rented' | 'reserved' | 'maintenance' | null => {
    for (const range of bookedRanges) {
      if (
        range.equipment_id === equipmentId &&
        range.start_date <= endDate &&
        range.end_date >= startDate
      ) {
        return range.block_type;
      }
    }
    const maintOverlap = maintenance.some(
      (record) =>
        record.equipment_id === equipmentId &&
        record.maintenance_status !== 'completed' &&
        record.maintenance_status !== 'cancelled' &&
        record.scheduled_date >= startDate &&
        record.scheduled_date <= endDate
    );
    if (maintOverlap) return 'maintenance';

    const orderOverlap = orders.find(
      (order) =>
        order.status !== 'cancelled' &&
        order.status !== 'completed' &&
        order.items?.some((item) => item.equipment_id === equipmentId) &&
        order.expected_start_date <= endDate &&
        order.expected_end_date >= startDate
    );
    if (orderOverlap) {
      return orderOverlap.status === 'in_progress' ? 'rented' : 'reserved';
    }
    return null;
  };

  const findNextAvailableDate = (equipmentId: string): string => {
    for (let offset = 0; offset < 60; offset += 1) {
      const candidate = addDaysToDateStr(todayDate, offset);
      if (!getEquipmentBlockOnDate(equipmentId, candidate)) {
        return candidate;
      }
    }
    return todayDate;
  };

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(''), 4000);
  };

  const handleAuthenticated = (profile: UserProfile) => {
    setActiveTab('Dashboard');
    setDashboardDataLoaded(false);
    setCurrentUser(profile);
    showToast(`Welcome back, ${profile.full_name}!`);
  };

  const customerAccounts = useMemo(
    () => usersList.filter((u) => u.role === 'customer' && u.account_status === 'active'),
    [usersList]
  );

  // Open reservation modal for either Customer (self) or Staff (booking on behalf of a Customer)
  const openBookingModal = (equip: Equipment, preferredStartDate?: string) => {
    if (!currentUser) return;
    const liveToday = toDateInputValue(new Date());
    const safeStart =
      preferredStartDate && preferredStartDate >= liveToday
        ? preferredStartDate
        : findNextAvailableDate(equip.id);

    setRentingEquipment(equip);
    setBookStartDate(safeStart < liveToday ? liveToday : safeStart);
    setBookDays('1');

    if (currentRole === 'staff') {
      const firstCust = customerAccounts[0];
      setBookSelectedCustomerId(firstCust?.id || '');
      setBookCustomerName(firstCust?.full_name || '');
      setBookCustomerPhone(firstCust?.phone || '');
    } else {
      setBookSelectedCustomerId(currentUser.id);
      setBookCustomerName(currentUser.full_name);
      setBookCustomerPhone(currentUser.phone);
    }
  };

  // 1. Customer or Staff-on-behalf-of-Customer Booking Submit with Strict Past-Date & Overlap Validation
  const handleBookingSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!rentingEquipment || !currentUser) return;
    try {
      const liveToday = toDateInputValue(new Date());
      const isStaffBooking = currentRole === 'staff';
      const targetCustomerId = isStaffBooking ? bookSelectedCustomerId : currentUser.id;

      if (isStaffBooking && !targetCustomerId) {
        throw new Error('Please select a Customer account to create this reservation for.');
      }
      if (!bookCustomerName.trim()) {
        throw new Error('Please enter the customer full name for the reservation confirmation.');
      }
      if (!bookCustomerPhone.trim()) {
        throw new Error('Please enter the contact phone number.');
      }
      const parsedDays = Number(bookDays);
      if (bookDays === '' || !Number.isInteger(parsedDays) || parsedDays < 1 || parsedDays > 30) {
        throw new Error('Rental duration must be between 1 and 30 days.');
      }
      if (!bookAddress.trim()) {
        throw new Error('Enter the shoot location or delivery address.');
      }
      // Strict Date Validation: Never allow past/previous dates!
      if (!bookStartDate || bookStartDate < liveToday) {
        throw new Error(
          `Cannot rent on previous dates (${bookStartDate || 'invalid'}). Please choose today (${liveToday}) or a future date.`
        );
      }
      const start = new Date(`${bookStartDate}T00:00:00`);
      if (Number.isNaN(start.getTime())) {
        throw new Error('Choose a valid rental start date.');
      }
      const startDateStr = toDateInputValue(start);
      if (startDateStr < liveToday) {
        throw new Error(
          `Cannot rent on previous dates. Please choose today (${liveToday}) or a future date.`
        );
      }
      const endDateStr = addDaysToDateStr(startDateStr, parsedDays - 1);

      if (
        rentingEquipment.current_status === 'under_maintenance' ||
        rentingEquipment.current_status === 'decommissioned'
      ) {
        throw new Error(
          'This equipment is currently under maintenance and must be marked as Repaired in Maintenance Queue before renting.'
        );
      }

      const overlapReason = doesRangeOverlapBooking(rentingEquipment.id, startDateStr, endDateStr);
      if (overlapReason) {
        throw new Error(
          overlapReason === 'maintenance'
            ? `This equipment is scheduled for maintenance during ${startDateStr} to ${endDateStr}.`
            : `This equipment is already reserved or rented during ${startDateStr} to ${endDateStr}. Please select open dates.`
        );
      }

      const dailyInsuranceRate = rentingEquipment.category?.base_daily_insurance_rate ?? 0;

      await createRentalOrder({
        customerId: targetCustomerId,
        equipmentId: rentingEquipment.id,
        unitDailyRate: rentingEquipment.daily_rental_rate,
        dailyInsuranceRate,
        days: parsedDays,
        startDate: startDateStr,
        endDate: endDateStr,
        deliveryAddress: bookAddress,
        customerName: bookCustomerName,
        customerPhone: formatPhilippinePhone(bookCustomerPhone),
        initialStatus: isStaffBooking ? 'confirmed' : 'draft',
        authorizedStaffId: isStaffBooking ? currentUser.id : undefined,
      });

      showToast(
        isStaffBooking
          ? `Reservation created & confirmed for ${bookCustomerName}! Ready in Dispatch & Checkout.`
          : `Reservation submitted for ${rentingEquipment.model_name}! Status is Pending.`
      );
      setRentingEquipment(null);
      await reloadData();
      setActiveTab(isStaffBooking ? 'Orders & Requests' : 'My Reservations');
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Booking failed');
    }
  };

  // 2. Customer Cancels Pending Request (cannot cancel once confirmed or accepted)
  const handleCancelReservation = async (orderId: string) => {
    const orderToCancel = orders.find((o) => o.id === orderId);
    if (!orderToCancel) return;

    if (orderToCancel.status !== 'draft') {
      showToast('This reservation has already been confirmed or processed and cannot be cancelled.');
      return;
    }

    if (!window.confirm('Are you sure you want to cancel this pending reservation request?')) {
      return;
    }

    try {
      await cancelRentalOrder(orderId, currentUser?.id);
      showToast('Your pending reservation has been successfully cancelled.');
      await reloadData();
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Could not cancel reservation.');
    }
  };

  // 3. Staff Approves Reservation
  const handleApproveReservation = async (orderId: string) => {
    setReservationUpdating(true);
    try {
      await updateRentalOrderStatus(orderId, 'confirmed');
      showToast('Reservation confirmed and approved.');
      await reloadData();
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Could not approve reservation');
    } finally {
      setReservationUpdating(false);
    }
  };

  // 4. Staff Rejects Reservation
  const handleRejectReservation = async (orderId: string) => {
    setReservationUpdating(true);
    try {
      await updateRentalOrderStatus(orderId, 'cancelled');
      showToast('Reservation rejected.');
      await reloadData();
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Could not reject reservation');
    } finally {
      setReservationUpdating(false);
    }
  };

  // 5. Staff Dispatches Equipment (Validation: Cannot dispatch past/expired orders without rescheduling)
  const handleDispatchCheckout = async (orderId: string) => {
    if (!currentUser) return;
    try {
      const targetOrder = orders.find((o) => o.id === orderId);
      if (targetOrder && targetOrder.expected_end_date < todayDate) {
        throw new Error(
          'Rental end date has already passed. Click "Move to Today & Dispatch" to shift the rental dates to today.'
        );
      }
      await executeRentalDispatch(orderId, currentUser.id);
      showToast('Equipment checked out and handed off to customer.');
      await reloadData();
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Dispatch failed');
    }
  };

  // 5b. One-click fix for Expired Confirmed Orders: shift dates to start today & dispatch immediately
  const handleRescheduleAndDispatch = async (order: RentalOrder) => {
    if (!currentUser) return;
    setReservationUpdating(true);
    try {
      const bookedDays = Math.max(1, order.items?.[0]?.days_rented || 1);
      const newStartDate = todayDate;
      const newEndDate = addDaysToDateStr(todayDate, bookedDays - 1);

      await rescheduleConfirmedOrderDates(order.id, newStartDate, newEndDate);
      await executeRentalDispatch(order.id, currentUser.id);
      showToast(
        `Order rescheduled to ${newStartDate} → ${newEndDate} and dispatched to customer!`
      );
      await reloadData();
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Could not reschedule and dispatch order.');
    } finally {
      setReservationUpdating(false);
    }
  };

  // 5c. Cancel an Expired Confirmed Order if customer did not pick up
  const handleCancelExpiredOrder = async (orderId: string) => {
    if (
      !window.confirm(
        'Cancel this expired reservation so the equipment dates are freed up?'
      )
    ) {
      return;
    }
    setReservationUpdating(true);
    try {
      await staffCancelConfirmedOrder(orderId);
      showToast('Expired order cancelled.');
      await reloadData();
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Could not cancel expired order.');
    } finally {
      setReservationUpdating(false);
    }
  };

  // 6. Staff Return Inspection (Okay -> Available immediately; Damaged -> Under Maintenance + Work Order)
  const handleReturnSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!returningItemId || !currentUser) return;
    try {
      if (!returnPhysicallyReceived) {
        throw new Error(
          'Verification Required: Confirm that the customer has physically returned this equipment first.'
        );
      }
      const parsedPenaltyFee =
        returnCondition === 'damaged' && penaltyFee !== '' ? Number(penaltyFee) : 0;
      if (!Number.isFinite(parsedPenaltyFee) || parsedPenaltyFee < 0) {
        throw new Error('Enter a valid non-negative damage penalty amount.');
      }

      const targetRow = returnableOrderItems.find((r) => r.itemId === returningItemId);

      const res = await executeEquipmentReturn({
        orderItemId: returningItemId,
        orderId: targetRow?.orderId,
        equipmentId: targetRow?.equipmentId,
        condition: returnCondition,
        dispatchHours: targetRow?.dispatchHours,
        inspectorId: currentUser.id,
        notes: damageNotes || undefined,
        penaltyFee: parsedPenaltyFee,
      });

      showToast(
        res.maintenanceCreated
          ? 'Rental Completed! Damaged item moved to Maintenance Queue until marked as Repaired.'
          : 'Rental Completed! Equipment is now Available in Inventory.'
      );
      setReturningItemId(null);
      setReturnCondition('okay');
      setDamageNotes('');
      setPenaltyFee('');
      setReturnPhysicallyReceived(false);
      await reloadData();
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Return check-in failed');
    }
  };

  // 6b. Mark Under-Maintenance Equipment as Repaired -> Automatically sets Equipment to Available
  const handleMarkMaintenanceFixed = async (equipmentId: string, maintenanceId?: string) => {
    const busyKey = maintenanceId || equipmentId;
    setMaintenanceUpdatingId(busyKey);
    try {
      await completeMaintenanceRepair({
        maintenanceId,
        equipmentId,
        technicianId: currentUser?.id,
      });
      showToast('Equipment marked as Repaired and automatically set to Available in Inventory!');
      await reloadData();
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Could not mark equipment as repaired.');
    } finally {
      setMaintenanceUpdatingId(null);
    }
  };

  // 6c. Send Available Equipment to Maintenance (creates maintenance_records + maintenance_tasks + updates equipment)
  const handleSendToMaintenanceSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!maintTargetEquip || !currentUser) return;
    setMaintSaving(true);
    try {
      await sendEquipmentToMaintenance({
        equipmentId: maintTargetEquip.id,
        technicianId: currentUser.id,
        maintenanceType: maintType,
        description: maintDesc || 'Scheduled equipment inspection & calibration',
        taskName: maintTaskName || 'Diagnostic Inspection & Calibration',
        hoursLogged: Number(maintHours) || 1,
        hourlyLaborRate: Number(maintHourlyRate) || 500,
      });
      showToast(
        `${maintTargetEquip.model_name} sent to Maintenance — saved in equipment, maintenance_records, and maintenance_tasks!`
      );
      setMaintTargetEquip(null);
      setMaintDesc('');
      await reloadData();
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Could not send equipment to maintenance.');
    } finally {
      setMaintSaving(false);
    }
  };

  // 6d. Maintenance Tasks CRUD (maintenance_tasks <-> maintenance_records cost sync)
  const handleAddMaintTaskSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!managingMaintId || !currentUser) return;
    setTaskSaving(true);
    try {
      if (!newTaskName.trim()) {
        throw new Error('Enter a repair task name.');
      }
      await addMaintenanceTask({
        maintenanceId: managingMaintId,
        technicianId: currentUser.id,
        taskName: newTaskName.trim(),
        hoursLogged: Number(newTaskHours) || 1,
        hourlyLaborRate: Number(newTaskRate) || 500,
        findingsReport: newTaskReport.trim() || undefined,
      });
      showToast('Repair task saved in maintenance_tasks and work order cost synced!');
      setNewTaskName('');
      setNewTaskHours('1');
      setNewTaskReport('');
      await reloadData();
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Could not add maintenance task.');
    } finally {
      setTaskSaving(false);
    }
  };

  const handleRemoveMaintTask = async (taskId: string, maintenanceId: string) => {
    try {
      await deleteMaintenanceTask({ taskId, maintenanceId });
      showToast('Task removed from maintenance_tasks and work order cost recalculated.');
      await reloadData();
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Could not delete maintenance task.');
    }
  };

  // 6e. Order Items CRUD (rental_order_items <-> rental_orders totals sync)
  const openManageOrderItems = (order: RentalOrder) => {
    const drafts: Record<string, { rate: string; days: string }> = {};
    for (const item of order.items || []) {
      drafts[item.id] = {
        rate: String(item.unit_daily_rate),
        days: String(item.days_rented),
      };
    }
    setItemEditDrafts(drafts);
    const existingIds = new Set((order.items || []).map((i) => i.equipment_id));
    const candidate =
      availableEquipment.find((eq) => !existingIds.has(eq.id)) || availableEquipment[0];
    setNewOrderItemEquipId(candidate?.id || '');
    setNewOrderItemRate(candidate ? String(candidate.daily_rental_rate) : '');
    setNewOrderItemDays(String(order.items?.[0]?.days_rented || 1));
    setManagingOrderId(order.id);
  };

  const handleSaveOrderItemEdit = async (
    order: RentalOrder,
    itemId: string
  ) => {
    const draft = itemEditDrafts[itemId];
    if (!draft) return;
    setOrderItemSaving(true);
    try {
      await updateOrderItem({
        itemId,
        orderId: order.id,
        unitDailyRate: Number(draft.rate),
        daysRented: Number(draft.days),
        orderStartDate: order.expected_start_date,
      });
      showToast('Order item updated in rental_order_items and order total recalculated!');
      await reloadData();
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Could not update order item.');
    } finally {
      setOrderItemSaving(false);
    }
  };

  const handleAddOrderItemSubmit = async (e: React.FormEvent, order: RentalOrder) => {
    e.preventDefault();
    if (!newOrderItemEquipId) {
      showToast('Select an available equipment unit to add.');
      return;
    }
    setOrderItemSaving(true);
    try {
      const equip = equipmentList.find((eq) => eq.id === newOrderItemEquipId);
      const rate = Number(newOrderItemRate) || equip?.daily_rental_rate || 1000;
      const days = Math.max(1, Number(newOrderItemDays) || 1);
      const insRate = equip?.category?.base_daily_insurance_rate ?? 0;

      const added = await addOrderItem({
        orderId: order.id,
        equipmentId: newOrderItemEquipId,
        unitDailyRate: rate,
        dailyInsuranceRate: insRate,
        daysRented: days,
      });
      setItemEditDrafts((prev) => ({
        ...prev,
        [added.id]: { rate: String(added.unit_daily_rate), days: String(added.days_rented) },
      }));
      showToast('Item added to rental_order_items and rental_orders total updated!');
      await reloadData();
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Could not add item to order.');
    } finally {
      setOrderItemSaving(false);
    }
  };

  const handleRemoveOrderItem = async (orderId: string, itemId: string) => {
    if (!window.confirm('Remove this equipment item from the rental order?')) {
      return;
    }
    setOrderItemSaving(true);
    try {
      const res = await deleteOrderItem({ itemId, orderId });
      if (res.orderDeletedOrCancelled) {
        setManagingOrderId(null);
        showToast('Last item removed — empty order was automatically removed/cancelled.');
      } else {
        showToast('Item deleted from rental_order_items and order total recalculated!');
      }
      await reloadData();
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Could not remove item from order.');
    } finally {
      setOrderItemSaving(false);
    }
  };

  // 6f. Payment Recording (payment_transactions <-> rental_orders.payment_status sync)
  const handleRecordPaymentSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!payingOrder || !currentUser) return;
    setPaymentSaving(true);
    try {
      await recordOrderPayment({
        orderId: payingOrder.id,
        amount: Number(paymentAmount),
        paymentMethod,
        processedBy: currentUser.id,
      });
      showToast(
        `Payment recorded in payment_transactions and ${payingOrder.order_number} payment status synced!`
      );
      setPayingOrder(null);
      await reloadData();
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Could not record payment.');
    } finally {
      setPaymentSaving(false);
    }
  };

  // 6g. Admin Categories & Studio Branches CRUD (equipment_categories & warehouse_locations)
  const handleCreateCategorySubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      if (!catName.trim() || !catCode.trim()) {
        throw new Error('Category Name and Code are required.');
      }
      await createEquipmentCategory({
        category_name: catName,
        category_code: catCode,
        description: catDesc,
        base_daily_insurance_rate: Number(catInsuranceRate) || 0,
      });
      showToast(`Category "${catName}" saved to equipment_categories!`);
      setCatName('');
      setCatCode('');
      setCatDesc('');
      await reloadData();
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Could not create category.');
    }
  };

  const handleDeleteCategory = async (id: string, name: string) => {
    if (!window.confirm(`Delete category "${name}" from equipment_categories?`)) return;
    try {
      await deleteEquipmentCategory(id);
      showToast(`Category "${name}" deleted from equipment_categories.`);
      await reloadData();
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Could not delete category.');
    }
  };

  const handleCreateWarehouseSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      if (!whCode.trim() || !whName.trim() || !whAddress.trim()) {
        throw new Error('Branch Code, Name, and Address are required.');
      }
      await createWarehouse({
        branch_code: whCode,
        branch_name: whName,
        address: whAddress,
        city: whCity || 'Quezon City',
        region: whRegion || 'NCR',
        contact_phone: formatPhilippinePhone(whPhone),
        max_storage_capacity: Number(whCapacity) || 100,
      });
      showToast(`Branch "${whName}" saved to warehouse_locations!`);
      setWhCode('');
      setWhName('');
      setWhAddress('');
      await reloadData();
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Could not create branch.');
    }
  };

  const handleDeleteWarehouse = async (id: string, name: string) => {
    if (!window.confirm(`Delete branch "${name}" from warehouse_locations?`)) return;
    try {
      await deleteWarehouse(id);
      showToast(`Branch "${name}" deleted from warehouse_locations.`);
      await reloadData();
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Could not delete branch.');
    }
  };

  // 7. Admin CRUD: Add New Equipment
  const handleCreateEquipment = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      if (!eqModelName.trim() || !eqSerialNumber.trim() || !eqManufacturer.trim()) {
        throw new Error('Please fill in Model Name, Serial Number, and Manufacturer.');
      }
      const categoryId = eqCategoryId || categoriesList[0]?.id;
      const warehouseId = eqWarehouseId || warehousesList[0]?.id;
      if (!categoryId || !warehouseId) {
        throw new Error('Please ensure at least one Category and Warehouse exist in the system.');
      }
      await createEquipment({
        serial_number: eqSerialNumber.trim(),
        model_name: eqModelName.trim(),
        manufacturer: eqManufacturer.trim(),
        model_year: Number(eqModelYear) || 2024,
        category_id: categoryId,
        warehouse_id: warehouseId,
        daily_rental_rate: Number(eqDailyRate) || 1000,
        replacement_value: Number(eqReplacementVal) || 50000,
        image_url: eqImageUrl.trim() || undefined,
      });
      showToast(`Equipment ${eqModelName} successfully added to fleet.`);
      setIsAddEquipmentOpen(false);
      setEqSerialNumber('');
      setEqModelName('');
      setEqManufacturer('');
      setEqDailyRate('');
      setEqReplacementVal('');
      setEqImageUrl('');
      await reloadData();
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Could not add equipment.');
    }
  };

  // 8. Admin CRUD: Edit Equipment
  const handleUpdateEquipment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingEquipment) return;
    try {
      await updateEquipmentDetails(editingEquipment.id, {
        model_name: eqModelName.trim() || editingEquipment.model_name,
        manufacturer: eqManufacturer.trim() || editingEquipment.manufacturer,
        daily_rental_rate: Number(eqDailyRate) || editingEquipment.daily_rental_rate,
        replacement_value: Number(eqReplacementVal) || editingEquipment.replacement_value,
        category_id: eqCategoryId || editingEquipment.category_id,
        warehouse_id: eqWarehouseId || editingEquipment.warehouse_id,
        image_url: eqImageUrl.trim() || undefined,
      });
      showToast(`Equipment ${editingEquipment.model_name} updated.`);
      setEditingEquipment(null);
      await reloadData();
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Could not update equipment.');
    }
  };

  // 9. Admin CRUD: Delete Equipment
  const handleDeleteEquipment = async (equipId: string, modelName: string) => {
    if (!window.confirm(`Are you sure you want to remove ${modelName} from the fleet?`)) {
      return;
    }
    try {
      await deleteEquipment(equipId);
      showToast(`Equipment ${modelName} removed.`);
      await reloadData();
    } catch (err: unknown) {
      showToast(
        err instanceof Error
          ? err.message
          : 'Could not delete equipment. It may be linked to active contracts.'
      );
    }
  };

  // 10. Admin User Management: Add Staff Member
  const handleAddStaffSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setStaffSaving(true);
    try {
      if (!staffFullName.trim() || !staffEmail.trim() || !staffPhone.trim()) {
        throw new Error('Please provide Full Name, Email, and Phone number.');
      }
      if (!staffPassword || staffPassword.length < 6) {
        throw new Error('Initial staff password must be at least 6 characters.');
      }
      await addStaffMember({
        fullName: staffFullName.trim(),
        email: staffEmail.trim(),
        phone: formatPhilippinePhone(staffPhone),
        password: staffPassword,
      });
      showToast(`Staff member ${staffFullName} successfully added!`);
      setIsAddStaffOpen(false);
      setStaffFullName('');
      setStaffEmail('');
      setStaffPhone('');
      setStaffPassword('');
      await reloadData();
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Could not add staff member.');
    } finally {
      setStaffSaving(false);
    }
  };

  // 11. Admin User Management: Remove Staff or Customer
  const handleDeleteUser = async (userId: string, userName: string, role: string) => {
    if (role === 'admin') {
      showToast('Action Denied: The primary administrator account cannot be removed.');
      return;
    }
    if (!window.confirm(`Are you sure you want to remove ${role} "${userName}"?`)) {
      return;
    }
    try {
      await deleteUserProfile(userId);
      showToast(`${role} ${userName} has been removed.`);
      await reloadData();
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : `Could not remove ${role}.`);
    }
  };

  // Profile update
  const handleProfileUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    setProfileSaving(true);
    try {
      if (!currentUser) return;
      const updated = await updateUserProfile({
        id: currentUser.id,
        fullName: profileName,
        phone: formatPhilippinePhone(profilePhone),
        companyName: profileCompany,
      });
      setCurrentUser(updated);
      showToast('Profile saved.');
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Could not save profile');
    } finally {
      setProfileSaving(false);
    }
  };

  // Visible Equipment filters
  const visibleEquipment = useMemo(() => {
    return equipmentList.filter((item) => {
      const matchesCat = category === 'All equipment' || item.category?.category_name === category;
      const matchesQuery =
        item.model_name.toLowerCase().includes(query.toLowerCase()) ||
        item.manufacturer.toLowerCase().includes(query.toLowerCase());
      const matchesPrice = maxPrice === null || item.daily_rental_rate <= maxPrice;
      return matchesCat && matchesQuery && matchesPrice;
    });
  }, [equipmentList, category, query, maxPrice]);

  // Calendar helpers
  const selectedCalEquip = useMemo(() => {
    return equipmentList.find((e) => e.id === calEquipId) || equipmentList[0];
  }, [equipmentList, calEquipId]);

  const selectedDateBlockReason = selectedCalEquip
    ? getEquipmentBlockOnDate(selectedCalEquip.id, calSelectedDate)
    : null;

  const selectedDateBlocked = Boolean(
    selectedCalEquip &&
      (calSelectedDate < todayDate ||
        selectedCalEquip.current_status === 'decommissioned' ||
        selectedCalEquip.current_status === 'under_maintenance' ||
        selectedDateBlockReason !== null ||
        (calSelectedDate === todayDate && selectedCalEquip.current_status !== 'available'))
  );

  const calendarYear = calendarMonth.getFullYear();
  const calendarMonthIndex = calendarMonth.getMonth();
  const calendarMonthLabel = calendarMonth.toLocaleDateString(undefined, {
    month: 'long',
    year: 'numeric',
  });
  const calendarDates = Array.from(
    { length: 42 },
    (_, index) =>
      new Date(
        calendarYear,
        calendarMonthIndex,
        index - new Date(calendarYear, calendarMonthIndex, 1).getDay() + 1
      )
  );

  // Booking calculations for modal
  const bookingInsuranceRate = rentingEquipment?.category?.base_daily_insurance_rate ?? 0;
  const bookingDays = Number(bookDays) || 0;
  const bookingPastDateError = Boolean(!bookStartDate || bookStartDate < todayDate);
  const bookingEndDate =
    bookStartDate && bookingDays >= 1 ? addDaysToDateStr(bookStartDate, bookingDays - 1) : '';
  const bookingOverlapReason =
    rentingEquipment && bookStartDate && !bookingPastDateError
      ? doesRangeOverlapBooking(
          rentingEquipment.id,
          bookStartDate,
          bookingEndDate || bookStartDate
        )
      : null;
  const bookingSubtotal = rentingEquipment ? rentingEquipment.daily_rental_rate * bookingDays : 0;
  const bookingInsurance = bookingInsuranceRate * bookingDays;
  const bookingTax = Math.round((bookingSubtotal + bookingInsurance) * 0.08 * 100) / 100;
  const bookingTotal = Math.round((bookingSubtotal + bookingInsurance + bookingTax) * 100) / 100;

  // Staff merged orders list
  const filteredStaffOrders = useMemo(() => {
    return orders.filter((o) => {
      const matchesFilter = staffOrderFilter === 'all' ? true : o.status === staffOrderFilter;
      const searchLower = staffOrderSearch.toLowerCase();
      const matchesSearch =
        !staffOrderSearch ||
        o.order_number.toLowerCase().includes(searchLower) ||
        (o.customer?.full_name || '').toLowerCase().includes(searchLower) ||
        (o.items?.[0]?.equipment?.model_name || '').toLowerCase().includes(searchLower) ||
        (o.delivery_address || '').toLowerCase().includes(searchLower);
      return matchesFilter && matchesSearch;
    });
  }, [orders, staffOrderFilter, staffOrderSearch]);

  // Admin user list filtered
  const filteredUsers = useMemo(() => {
    return usersList.filter((u) => {
      const matchesRole = u.role === adminUserTab;
      const searchLower = userSearch.toLowerCase();
      const matchesSearch =
        !userSearch ||
        u.full_name.toLowerCase().includes(searchLower) ||
        u.email.toLowerCase().includes(searchLower) ||
        u.phone.toLowerCase().includes(searchLower);
      return matchesRole && matchesSearch;
    });
  }, [usersList, adminUserTab, userSearch]);

  if (!isSupabaseConfigured) {
    return <AuthScreen onAuthenticated={handleAuthenticated} />;
  }

  if (authChecking) {
    return <LoadingScreen />;
  }

  if (!currentUser) {
    return <AuthScreen onAuthenticated={handleAuthenticated} />;
  }

  if (!dashboardDataLoaded) {
    return <LoadingScreen />;
  }

  const activeUser = currentUser;

  return (
    <div className="outer-lavender-wrap">
      {/* Toast Alert */}
      {toast && (
        <div
          role="alert"
          style={{
            position: 'fixed',
            bottom: 24,
            right: 24,
            background: '#111827',
            color: '#ffffff',
            padding: '12px 20px',
            borderRadius: 14,
            zIndex: 9999,
            fontSize: 13,
            fontWeight: 600,
            boxShadow: '0 10px 30px rgba(0,0,0,0.25)',
          }}
        >
          {toast}
        </div>
      )}

      <div className="finset-frame">
        {/* SIDEBAR NAVIGATION */}
        <aside className="finset-sidebar">
          {/* Brand Header */}
          <div className="finset-brand">
            <div className="brand-left">
              <span className="brand-name">
                Equip<span>Rent</span>
              </span>
            </div>
            <div className="sidebar-collapse-icon">&lsaquo;</div>
          </div>

          {dataLoadError && (
            <div
              role="alert"
              style={{
                padding: 10,
                marginBottom: 14,
                borderRadius: 12,
                background: 'var(--red-bg)',
                color: 'var(--red-kpi)',
                fontSize: 11,
              }}
            >
              Could not load data: {dataLoadError}
            </div>
          )}

          {/* Navigation Items */}
          <nav className="finset-nav">
            {navTabs.map((tab) => (
              <button
                key={tab.label}
                className={`finset-nav-btn ${activeTab === tab.label ? 'active' : ''}`}
                onClick={() => setActiveTab(tab.label)}
              >
                <span>{tab.label}</span>
                {tab.badge && <span className="nav-badge-pill">{tab.badge}</span>}
              </button>
            ))}
          </nav>

          {/* Sidebar Bottom Controls */}
          <div className="finset-sidebar-bottom">
            <button className="sidebar-action-btn" onClick={handleLogout}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                <polyline points="16 17 21 12 16 7" />
                <line x1="21" y1="12" x2="9" y2="12" />
              </svg>
              <span>Log out</span>
            </button>
          </div>
        </aside>

        {/* MAIN WORKSPACE CONTENT */}
        <main className="finset-main">
          {/* Mobile Top Bar with Log Out button */}
          <div className="mobile-top-bar">
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span className="brand-name" style={{ fontSize: 16 }}>
                Equip<span>Rent</span>
              </span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span
                style={{
                  fontSize: 10,
                  fontWeight: 800,
                  padding: '3px 8px',
                  borderRadius: 10,
                  background: 'var(--purple-light)',
                  color: 'var(--purple-main)',
                  textTransform: 'uppercase',
                }}
              >
                {currentRole}
              </span>
              <button
                type="button"
                className="mobile-logout-btn"
                onClick={handleLogout}
                title="Log out of session"
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                  <polyline points="16 17 21 12 16 7" />
                  <line x1="21" y1="12" x2="9" y2="12" />
                </svg>
                <span>Log out</span>
              </button>
            </div>
          </div>

          {/* TOP HEADER */}
          <div
            className="finset-header"
            style={{
              marginBottom: 20,
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              flexWrap: 'wrap',
              gap: 12,
            }}
          >
            <div>
              <h1 className="greeting-title">
                {activeTab !== 'Dashboard'
                  ? activeTab
                  : currentRole === 'customer'
                    ? 'Customer Dashboard'
                    : currentRole === 'staff'
                      ? 'Staff Dashboard'
                      : 'Admin Overview'}
              </h1>
              <span className="greeting-sub">
                {currentRole === 'customer'
                  ? 'Camera, lighting, audio & studio equipment rental hub'
                  : currentRole === 'staff'
                    ? 'Equipment operations, dispatch handoff, returns & maintenance'
                    : 'Studio inventory oversight, equipment catalog & user control'}
              </span>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span
                style={{
                  padding: '6px 14px',
                  borderRadius: 16,
                  background: 'var(--purple-light)',
                  color: 'var(--purple-main)',
                  fontSize: 12,
                  fontWeight: 800,
                  textTransform: 'uppercase',
                }}
              >
                {currentRole}
              </span>
            </div>
          </div>

          {/* TAB 1: DASHBOARD / OVERVIEW */}
          {activeTab === 'Dashboard' && (
            <div>
              {/* Metric Cards Grid */}
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
                  gap: 16,
                  marginBottom: 24,
                }}
              >
                <div className="donut-breakdown-card">
                  <span style={{ fontSize: 12, color: 'var(--text-muted)', fontWeight: 600 }}>Total Fleet</span>
                  <div style={{ fontSize: 26, fontWeight: 800, color: '#111827', margin: '6px 0' }}>
                    {totalFleet} <span style={{ fontSize: 14, fontWeight: 500 }}>Units</span>
                  </div>
                  <div style={{ fontSize: 12, color: '#047857', fontWeight: 600 }}>
                    {availableEquipment.length} Available to Rent
                  </div>
                </div>

                {currentRole === 'customer' ? (
                  <>
                    <div className="donut-breakdown-card">
                      <span style={{ fontSize: 12, color: 'var(--text-muted)', fontWeight: 600 }}>
                        My Active Rentals
                      </span>
                      <div style={{ fontSize: 26, fontWeight: 800, color: '#111827', margin: '6px 0' }}>
                        {activeContracts.length} <span style={{ fontSize: 14, fontWeight: 500 }}>Orders</span>
                      </div>
                      <div style={{ fontSize: 12, color: '#047857', fontWeight: 600 }}>
                        Confirmed or Dispatched
                      </div>
                    </div>

                    <div className="donut-breakdown-card">
                      <span style={{ fontSize: 12, color: 'var(--text-muted)', fontWeight: 600 }}>
                        My Pending Requests
                      </span>
                      <div style={{ fontSize: 26, fontWeight: 800, color: '#111827', margin: '6px 0' }}>
                        {pendingRequests.length} <span style={{ fontSize: 14, fontWeight: 500 }}>Pending</span>
                      </div>
                      <div style={{ fontSize: 12, color: '#b45309', fontWeight: 600 }}>
                        Awaiting Staff Review
                      </div>
                    </div>

                    <div className="donut-breakdown-card">
                      <span style={{ fontSize: 12, color: 'var(--text-muted)', fontWeight: 600 }}>
                        My Rental Total
                      </span>
                      <div style={{ fontSize: 24, fontWeight: 800, color: '#111827', margin: '6px 0' }}>
                        {formatPHP(totalRentalRevenue)}
                      </div>
                      <div style={{ fontSize: 12, color: 'var(--purple-main)', fontWeight: 600 }}>
                        {orders.filter((o) => o.status !== 'cancelled').length} Personal Bookings
                      </div>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="donut-breakdown-card">
                      <span style={{ fontSize: 12, color: 'var(--text-muted)', fontWeight: 600 }}>Fleet Valuation</span>
                      <div style={{ fontSize: 24, fontWeight: 800, color: '#111827', margin: '6px 0' }}>
                        {formatPHP(totalFleetValuation)}
                      </div>
                      <div style={{ fontSize: 12, color: 'var(--purple-main)', fontWeight: 600 }}>
                        {equipmentList.length} Listed Assets
                      </div>
                    </div>

                    <div className="donut-breakdown-card">
                      <span style={{ fontSize: 12, color: 'var(--text-muted)', fontWeight: 600 }}>Total Revenue</span>
                      <div style={{ fontSize: 24, fontWeight: 800, color: '#111827', margin: '6px 0' }}>
                        {formatPHP(totalRentalRevenue)}
                      </div>
                      <div style={{ fontSize: 12, color: '#047857', fontWeight: 600 }}>
                        {orders.filter((o) => o.status !== 'cancelled').length} Confirmed Bookings
                      </div>
                    </div>

                    <div className="donut-breakdown-card">
                      <span style={{ fontSize: 12, color: 'var(--text-muted)', fontWeight: 600 }}>Active Rentals</span>
                      <div style={{ fontSize: 26, fontWeight: 800, color: '#111827', margin: '6px 0' }}>
                        {activeContracts.length} <span style={{ fontSize: 14, fontWeight: 500 }}>Orders</span>
                      </div>
                      <div style={{ fontSize: 12, color: '#b45309', fontWeight: 600 }}>
                        {pendingRequests.length} Pending Approval
                      </div>
                    </div>
                  </>
                )}
              </div>

              {/* Admin Overview Details */}
              {currentRole === 'admin' && (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 16 }}>
                  {/* Currently Borrowed Summary */}
                  <div className="donut-breakdown-card">
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                      <h3 className="chart-card-title">Currently Borrowed Equipment</h3>
                      <button
                        className="outline-pill-btn"
                        onClick={() => {
                          setAdminBorrowedTab('borrowed');
                          setActiveTab('Borrowed & Returned Items');
                        }}
                      >
                        View All ({borrowedItems.length}) &rarr;
                      </button>
                    </div>
                    {borrowedItems.length === 0 ? (
                      <p style={{ color: 'var(--text-muted)', fontSize: 13, padding: 12 }}>
                        No equipment is currently checked out to customers.
                      </p>
                    ) : (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                        {borrowedItems.slice(0, 4).map((b) => (
                          <div
                            key={b.itemId}
                            style={{
                              display: 'flex',
                              justifyContent: 'space-between',
                              alignItems: 'center',
                              padding: '10px 14px',
                              borderRadius: 12,
                              background: '#f8fafc',
                              border: '1px solid #e2e8f0',
                            }}
                          >
                            <div>
                              <strong style={{ fontSize: 13, color: '#0f172a' }}>{b.equipmentName}</strong>
                              <div style={{ fontSize: 11, color: '#64748b' }}>
                                Borrowed by: {b.customerName} ({b.customerPhone})
                              </div>
                            </div>
                            <div style={{ textAlign: 'right' }}>
                              <span className="in-progress-status-badge">Due {b.endDate}</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Returned Equipment Tracking Summary */}
                  <div className="donut-breakdown-card">
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                      <h3 className="chart-card-title">Returned Equipment Check</h3>
                      <button
                        className="outline-pill-btn"
                        onClick={() => {
                          setAdminBorrowedTab('returned');
                          setActiveTab('Borrowed & Returned Items');
                        }}
                      >
                        View All ({returnedItems.length}) &rarr;
                      </button>
                    </div>
                    {returnedItems.length === 0 ? (
                      <p style={{ color: 'var(--text-muted)', fontSize: 13, padding: 12 }}>
                        No returned equipment history recorded yet.
                      </p>
                    ) : (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                        {returnedItems.slice(0, 4).map((r) => (
                          <div
                            key={r.itemId}
                            style={{
                              display: 'flex',
                              justifyContent: 'space-between',
                              alignItems: 'center',
                              padding: '10px 14px',
                              borderRadius: 12,
                              background: '#f8fafc',
                              border: '1px solid #e2e8f0',
                            }}
                          >
                            <div>
                              <strong style={{ fontSize: 13, color: '#0f172a' }}>{r.equipmentName}</strong>
                              <div style={{ fontSize: 11, color: '#64748b' }}>Returned by: {r.customerName}</div>
                            </div>
                            <div style={{ textAlign: 'right' }}>
                              <span className="completed-status-badge">✓ Completed &bull; {r.returnDate}</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Customer / Staff Quick Overview */}
              {currentRole !== 'admin' && (
                <div className="donut-breakdown-card" style={{ marginTop: 12 }}>
                  <div className="donut-card-header">
                    <h3 className="chart-card-title">Fleet Availability</h3>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 14 }}>
                    {availableEquipment.slice(0, 4).map((item) => (
                      <div
                        key={item.id}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          padding: '10px 14px',
                          borderRadius: 14,
                          background: '#fbfbfe',
                          border: '1px solid var(--border-subtle)',
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                          {item.image_url ? (
                            <img
                              src={item.image_url}
                              alt={item.model_name}
                              style={{ width: 44, height: 44, borderRadius: 10, objectFit: 'cover' }}
                            />
                          ) : (
                            <div className="fleet-image-placeholder" aria-hidden="true">
                              {item.model_name.slice(0, 1)}
                            </div>
                          )}
                          <div>
                            <h5 style={{ margin: 0, fontSize: 13, fontWeight: 800, color: '#111827' }}>
                              {item.model_name}
                            </h5>
                            <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                              {formatPHP(item.daily_rental_rate)}/day &bull; {item.manufacturer}
                            </span>
                          </div>
                        </div>

                        {currentRole === 'customer' ? (
                          <button
                            className="reserve-purple-btn"
                            style={{ padding: '6px 14px', fontSize: 11 }}
                            onClick={() => openBookingModal(item)}
                          >
                            Reserve
                          </button>
                        ) : (
                          <button
                            className="reserve-purple-btn"
                            style={{ padding: '6px 14px', fontSize: 11 }}
                            onClick={() => openBookingModal(item)}
                          >
                            Rent for Customer
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* TAB 2: BROWSE EQUIPMENT / FLEET INVENTORY (WITH ADMIN CRUD) */}
          {(activeTab === 'Browse Equipment' || activeTab === 'Fleet Inventory') && (
            <div className="transactions-table-card" style={{ marginTop: 6 }}>
              <div className="table-card-header">
                <div>
                  <h3 className="chart-card-title">Fleet Equipment</h3>
                </div>

                <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
                  {currentRole === 'admin' && (
                    <>
                      <button
                        className="primary-purple-btn"
                        onClick={() => setIsAddEquipmentOpen(true)}
                        style={{ padding: '8px 16px', fontSize: 12 }}
                      >
                        + Add Equipment
                      </button>
                      <button
                        type="button"
                        className="outline-pill-btn"
                        onClick={() => setIsManageCategoriesOpen(true)}
                        style={{ padding: '8px 12px', fontSize: 12 }}
                      >
                        Categories ({categoriesList.length})
                      </button>
                      <button
                        type="button"
                        className="outline-pill-btn"
                        onClick={() => setIsManageWarehousesOpen(true)}
                        style={{ padding: '8px 12px', fontSize: 12 }}
                      >
                        Branches ({warehousesList.length})
                      </button>
                    </>
                  )}

                  <input
                    type="text"
                    placeholder="Search model or manufacturer..."
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    style={{
                      padding: '8px 14px',
                      borderRadius: 16,
                      border: '1px solid var(--border-subtle)',
                      fontSize: 12,
                      outline: 'none',
                    }}
                  />
                  <select
                    className="filter-select-pill"
                    value={category}
                    onChange={(e) => setCategory(e.target.value)}
                  >
                    <option value="All equipment">All equipment</option>
                    {Object.keys(categoriesMap)
                      .sort()
                      .map((categoryName) => (
                        <option key={categoryName} value={categoryName}>
                          {categoryName}
                        </option>
                      ))}
                  </select>

                  <div className="price-slider-wrap">
                    <label htmlFor="max-daily-rate">Max price/day</label>
                    <input
                      id="max-daily-rate"
                      type="number"
                      min="0"
                      step="0.01"
                      value={maxPrice ?? ''}
                      placeholder={String(maximumDailyRate)}
                      disabled={equipmentList.length === 0}
                      onChange={(e) =>
                        setMaxPrice(e.target.value === '' ? null : Number(e.target.value))
                      }
                      aria-label="Maximum daily rental price in Philippine pesos"
                    />
                  </div>
                </div>
              </div>

              <div className="fleet-cards-grid">
                {visibleEquipment.map((item) => (
                  <div className="fleet-unit-card" key={item.id}>
                    <div className="fleet-card-img-wrap">
                      {item.image_url ? (
                        <img src={item.image_url} alt={item.model_name} />
                      ) : (
                        <div className="fleet-image-placeholder">{item.model_name.slice(0, 1)}</div>
                      )}
                    </div>

                    <div className="fleet-card-body">
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span className="fleet-cat-badge">
                          {item.category?.category_name || 'Uncategorized'}
                        </span>
                        <span
                          style={{
                            fontSize: 10,
                            fontWeight: 700,
                            color:
                              item.current_status === 'available'
                                ? '#047857'
                                : item.current_status === 'rented'
                                  ? '#4338ca'
                                  : '#b45309',
                          }}
                        >
                          {item.current_status.toUpperCase()}
                        </span>
                      </div>
                      <h4 className="fleet-model-title">{item.model_name}</h4>
                      <p style={{ margin: '0 0 10px', fontSize: 11, color: 'var(--text-muted)' }}>
                        S/N: {item.serial_number} &bull; {item.manufacturer} ({item.model_year})
                      </p>

                      <div className="fleet-card-footer">
                        <div className="fleet-price-text">
                          {formatPHP(item.daily_rental_rate)} <span>/ day</span>
                        </div>
                        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                          <button
                            className="outline-pill-btn"
                            style={{ padding: '6px 10px', fontSize: 11 }}
                            onClick={() => {
                              setCalEquipId(item.id);
                              setActiveTab('Availability Calendar');
                            }}
                            title="View availability calendar"
                          >
                            📅 Calendar
                          </button>

                          {currentRole === 'customer' && (
                            <button
                              className="reserve-purple-btn"
                              disabled={item.current_status !== 'available'}
                              onClick={() => openBookingModal(item)}
                              style={{ opacity: item.current_status === 'available' ? 1 : 0.4 }}
                            >
                              Reserve
                            </button>
                          )}

                          {currentRole === 'staff' && (
                            item.current_status === 'available' ? (
                              <>
                                <button
                                  className="reserve-purple-btn"
                                  onClick={() => openBookingModal(item)}
                                >
                                  Rent for Customer
                                </button>
                                <button
                                  type="button"
                                  className="outline-pill-btn"
                                  style={{ padding: '6px 10px', fontSize: 11 }}
                                  onClick={() => {
                                    setMaintTargetEquip(item);
                                    setMaintType('scheduled_routine');
                                    setMaintDesc('');
                                    setMaintTaskName('Diagnostic Inspection & Calibration');
                                  }}
                                  title="Log a maintenance work order & repair task in Supabase"
                                >
                                  🔧 Maintenance
                                </button>
                              </>
                            ) : item.current_status === 'under_maintenance' ? (
                              <button
                                type="button"
                                className="outline-pill-btn"
                                style={{
                                  padding: '6px 10px',
                                  fontSize: 11,
                                  borderColor: '#f59e0b',
                                  color: '#b45309',
                                  background: '#fffbeb',
                                  fontWeight: 700,
                                }}
                                onClick={() => {
                                  setActiveTab('Maintenance Queue');
                                  showToast(
                                    'Click "Mark as Repaired" in Maintenance Queue to set this item back to Available.'
                                  );
                                }}
                                title="Under maintenance — must be marked as Repaired in Maintenance Queue"
                              >
                                🔧 Repair in Queue &rarr;
                              </button>
                            ) : (
                              <span className="in-progress-status-badge">Out on Rent</span>
                            )
                          )}

                          {currentRole === 'admin' && (
                            <div className="crud-btn-group">
                              {item.current_status === 'available' && (
                                <button
                                  type="button"
                                  className="outline-pill-btn"
                                  style={{ padding: '5px 8px', fontSize: 11 }}
                                  onClick={() => {
                                    setMaintTargetEquip(item);
                                    setMaintType('scheduled_routine');
                                    setMaintDesc('');
                                    setMaintTaskName('Diagnostic Inspection & Calibration');
                                  }}
                                  title="Send to Maintenance (creates maintenance_records + maintenance_tasks)"
                                >
                                  🔧 Service
                                </button>
                              )}
                              <button
                                className="edit-action-btn"
                                onClick={() => {
                                  setEditingEquipment(item);
                                  setEqModelName(item.model_name);
                                  setEqManufacturer(item.manufacturer);
                                  setEqDailyRate(String(item.daily_rental_rate));
                                  setEqReplacementVal(String(item.replacement_value));
                                  setEqCategoryId(item.category_id);
                                  setEqWarehouseId(item.warehouse_id);
                                  setEqImageUrl(item.image_url || '');
                                }}
                              >
                                Edit
                              </button>
                              <button
                                className="delete-action-btn"
                                onClick={() => handleDeleteEquipment(item.id, item.model_name)}
                              >
                                Remove
                              </button>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* TAB 3: AVAILABILITY CALENDAR (WITH FUTURE DATE VALIDATION) */}
          {activeTab === 'Availability Calendar' && (
            <div className="calendar-card">
              <div className="calendar-top-bar">
                <div>
                  <h3 className="chart-card-title">Availability Calendar</h3>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                  <label style={{ fontSize: 12, fontWeight: 700, color: '#374151' }}>Equipment</label>
                  <select
                    className="filter-select-pill"
                    value={calEquipId}
                    onChange={(e) => setCalEquipId(e.target.value)}
                    style={{ padding: '8px 14px', maxWidth: 280 }}
                  >
                    {equipmentList.map((eq) => (
                      <option key={eq.id} value={eq.id}>
                        {eq.model_name} ({formatPHP(eq.daily_rental_rate)}/day)
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Month Header and Legend */}
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  marginBottom: 14,
                  padding: '0 4px',
                  flexWrap: 'wrap',
                  gap: 10,
                }}
              >
                <h4 style={{ margin: 0, fontSize: 16, fontWeight: 800, color: '#111827' }}>
                  {calendarMonthLabel} &bull; {selectedCalEquip?.model_name || 'Select equipment'}
                </h4>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button
                    className="outline-pill-btn"
                    onClick={() =>
                      setCalendarMonth(new Date(calendarYear, calendarMonthIndex - 1, 1))
                    }
                  >
                    Previous
                  </button>
                  <button
                    className="outline-pill-btn"
                    onClick={() =>
                      setCalendarMonth(new Date(calendarYear, calendarMonthIndex + 1, 1))
                    }
                  >
                    Next
                  </button>
                </div>
                <div style={{ display: 'flex', gap: 14, fontSize: 11, fontWeight: 700 }}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                    <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#10b981' }} />
                    Available
                  </span>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                    <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#6e54f3' }} />
                    Rented / Reserved
                  </span>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                    <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#9ca3af' }} />
                    Past Date
                  </span>
                </div>
              </div>

              {/* Calendar Grid Header */}
              <div className="calendar-grid-header">
                <span>Sun</span>
                <span>Mon</span>
                <span>Tue</span>
                <span>Wed</span>
                <span>Thu</span>
                <span>Fri</span>
                <span>Sat</span>
              </div>

              {/* Calendar Day Cells */}
              <div className="calendar-grid-days">
                {calendarDates.map((date) => {
                  const dateStr = toDateInputValue(date);
                  const isSelected = calSelectedDate === dateStr;
                  const isCurrentMonth = date.getMonth() === calendarMonthIndex;
                  const isPast = dateStr < todayDate;
                  const blockReason = getEquipmentBlockOnDate(calEquipId, dateStr);
                  const isUnavailable = Boolean(
                    selectedCalEquip &&
                      (selectedCalEquip.current_status === 'decommissioned' ||
                        selectedCalEquip.current_status === 'under_maintenance' ||
                        (dateStr === todayDate && selectedCalEquip.current_status !== 'available'))
                  );

                  return (
                    <div
                      key={dateStr}
                      className={`calendar-day-cell ${isCurrentMonth ? '' : 'other-month'} ${isSelected ? 'selected' : ''}`}
                      style={{
                        opacity: isPast ? 0.45 : blockReason ? 0.8 : 1,
                        cursor: isPast ? 'not-allowed' : 'pointer',
                      }}
                      onClick={() => {
                        if (isPast) {
                          showToast('Cannot select past dates. Reservations require today or future dates.');
                          return;
                        }
                        setCalSelectedDate(dateStr);
                        if (blockReason === 'reserved' || blockReason === 'rented') {
                          showToast(
                            `This equipment is already ${blockReason} on ${dateStr}. Please choose an Open date.`
                          );
                          return;
                        }
                        if (blockReason === 'maintenance' || isUnavailable) {
                          showToast(`This equipment is unavailable on ${dateStr}.`);
                          return;
                        }
                        setBookStartDate(dateStr);
                      }}
                    >
                      <span className="day-num">{date.getDate()}</span>
                      {isPast ? (
                        <span className="calendar-chip" style={{ background: '#f3f4f6', color: '#9ca3af' }}>
                          Past
                        </span>
                      ) : blockReason === 'maintenance' ? (
                        <span className="calendar-chip maintenance">Service</span>
                      ) : blockReason === 'rented' ? (
                        <span className="calendar-chip booked">Rented</span>
                      ) : blockReason === 'reserved' ? (
                        <span className="calendar-chip booked">Reserved</span>
                      ) : isUnavailable ? (
                        <span className="calendar-chip booked">Unavailable</span>
                      ) : (
                        <span className="calendar-chip available">Open</span>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Selected Day Action Banner */}
              {selectedCalEquip && (
                <div
                  style={{
                    marginTop: 22,
                    padding: 18,
                    borderRadius: 18,
                    background: '#fafaff',
                    border: '1px solid var(--border-subtle)',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    flexWrap: 'wrap',
                    gap: 14,
                  }}
                >
                  <div>
                    <h5 style={{ margin: '0 0 4px', fontSize: 14, fontWeight: 800, color: '#111827' }}>
                      {calSelectedDate} · {selectedCalEquip.model_name}
                    </h5>
                    <p style={{ margin: 0, fontSize: 12, color: 'var(--text-muted)' }}>
                      {formatPHP(selectedCalEquip.daily_rental_rate)}/day ·{' '}
                      <strong
                        style={{
                          color: !selectedDateBlocked ? '#047857' : '#b45309',
                          textTransform: 'capitalize',
                        }}
                      >
                        {selectedDateBlockReason
                          ? `Already ${selectedDateBlockReason}`
                          : selectedDateBlocked
                            ? 'Unavailable'
                            : 'Available'}
                      </strong>
                    </p>
                  </div>

                  {currentRole === 'customer' || currentRole === 'staff' ? (
                    <button
                      className="primary-purple-btn"
                      disabled={selectedDateBlocked}
                      style={{ opacity: selectedDateBlocked ? 0.5 : 1, cursor: selectedDateBlocked ? 'not-allowed' : 'pointer' }}
                      onClick={() => openBookingModal(selectedCalEquip, calSelectedDate)}
                    >
                      {calSelectedDate < todayDate
                        ? `Past Date — Unavailable`
                        : selectedDateBlockReason
                          ? `Unavailable on ${calSelectedDate}`
                          : currentRole === 'staff'
                            ? `Rent for Customer on ${calSelectedDate}`
                            : `Reserve on ${calSelectedDate}`}
                    </button>
                  ) : (
                    <span className={selectedDateBlocked ? 'pending-status-badge' : 'confirmed-status-badge'}>
                      {selectedDateBlocked ? 'Booked / Unavailable' : 'Open for Booking'}
                    </span>
                  )}
                </div>
              )}
            </div>
          )}

          {/* TAB 4: MY RESERVATIONS (CUSTOMER VIEW WITH CANCELLATION & ACCURATE TOTAL DUE) */}
          {currentRole === 'customer' && activeTab === 'My Reservations' && (
            <div className="transactions-table-card" style={{ marginTop: 6 }}>
              <div className="table-card-header">
                <div>
                  <h3 className="chart-card-title">My Rental Reservations</h3>
                </div>
                <button className="primary-purple-btn" onClick={() => setActiveTab('Browse Equipment')}>
                  + Book Equipment
                </button>
              </div>

              <div className="table-responsive">
                <table className="finset-table">
                  <thead>
                    <tr>
                      <th>ORDER #</th>
                      <th>EQUIPMENT</th>
                      <th>RENTAL PERIOD</th>
                      <th>DELIVERY ADDRESS</th>
                      <th>SUBTOTAL</th>
                      <th>INSURANCE</th>
                      <th>TOTAL DUE</th>
                      <th>STATUS</th>
                      <th>ACTION</th>
                    </tr>
                  </thead>
                  <tbody>
                    {orders.map((o) => {
                      const totalDue = getOrderTotal(o);
                      const equipName = formatOrderEquipmentLabel(o);
                      return (
                        <tr key={o.id}>
                          <td>
                            <strong>{o.order_number}</strong>
                          </td>
                          <td>
                            <strong>{equipName}</strong>
                          </td>
                          <td>
                            {o.expected_start_date} &rarr; {o.expected_end_date}
                          </td>
                          <td>{o.delivery_address || '—'}</td>
                          <td>{formatPHP(o.subtotal_amount)}</td>
                          <td>{formatPHP(o.insurance_amount)}</td>
                          <td style={{ fontWeight: 800, color: 'var(--purple-main)' }}>
                            {formatPHP(totalDue)}
                          </td>
                          <td>
                            {o.status === 'draft' ? (
                              <span className="pending-status-badge">⏳ Pending Approval</span>
                            ) : o.status === 'confirmed' ? (
                              <span className="confirmed-status-badge">✓ Confirmed</span>
                            ) : o.status === 'in_progress' ? (
                              <span className="in-progress-status-badge">🚚 Dispatched</span>
                            ) : o.status === 'completed' ? (
                              <span className="completed-status-badge">✓ Completed</span>
                            ) : (
                              <span className="cancelled-status-badge">Cancelled</span>
                            )}
                          </td>
                          <td>
                            {/* Cancellation rules: customer can cancel ONLY when pending (draft). Once confirmed/accepted, cannot cancel! */}
                            {o.status === 'draft' ? (
                              <button
                                className="cancel-reservation-btn"
                                onClick={() => handleCancelReservation(o.id)}
                                title="Cancel this pending reservation"
                              >
                                Cancel Request
                              </button>
                            ) : o.status === 'confirmed' || o.status === 'in_progress' ? (
                              <span style={{ fontSize: 11, color: '#047857', fontWeight: 600 }}>
                                Confirmed (Locked)
                              </span>
                            ) : o.status === 'completed' ? (
                              <span style={{ fontSize: 11, color: '#047857', fontWeight: 700 }}>
                                ✓ Completed
                              </span>
                            ) : (
                              <span style={{ fontSize: 11, color: '#9ca3af' }}>—</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                    {orders.length === 0 && (
                      <tr>
                        <td colSpan={9} style={{ textAlign: 'center', padding: 30, color: 'var(--text-muted)' }}>
                          You have no rental reservations yet. Click "+ Book Equipment" to start renting.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* TAB 5: MERGED ORDERS & REQUESTS (STAFF VIEW) */}
          {currentRole === 'staff' && activeTab === 'Orders & Requests' && (
            <div className="transactions-table-card" style={{ marginTop: 6 }}>
              <div className="table-card-header">
                <div>
                  <h3 className="chart-card-title">Orders & Reservation Requests</h3>
                </div>
                <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
                  <button
                    type="button"
                    className="primary-purple-btn"
                    style={{ padding: '8px 16px', fontSize: 12 }}
                    onClick={() => {
                      const firstAvailable = availableEquipment[0];
                      if (!firstAvailable) {
                        showToast('No available equipment in inventory right now.');
                        return;
                      }
                      openBookingModal(firstAvailable);
                    }}
                  >
                    + Rent for Customer
                  </button>
                  <input
                    type="text"
                    placeholder="Search customer, order #, equipment..."
                    value={staffOrderSearch}
                    onChange={(e) => setStaffOrderSearch(e.target.value)}
                    style={{
                      padding: '8px 14px',
                      borderRadius: 16,
                      border: '1px solid var(--border-subtle)',
                      fontSize: 12,
                      outline: 'none',
                    }}
                  />
                </div>
              </div>

              {/* Status Filter Tabs */}
              <div style={{ display: 'flex', gap: 8, padding: '0 4px 14px', flexWrap: 'wrap' }}>
                {(
                  [
                    ['all', 'All Orders', orders.length],
                    ['draft', 'Pending Requests', orders.filter((o) => o.status === 'draft').length],
                    ['confirmed', 'Confirmed', orders.filter((o) => o.status === 'confirmed').length],
                    ['in_progress', 'Dispatched', orders.filter((o) => o.status === 'in_progress').length],
                    ['completed', 'Completed', orders.filter((o) => o.status === 'completed').length],
                    ['cancelled', 'Cancelled', orders.filter((o) => o.status === 'cancelled').length],
                  ] as const
                ).map(([statusKey, label, count]) => (
                  <button
                    key={statusKey}
                    type="button"
                    className={`auth-tab-btn-finset ${staffOrderFilter === statusKey ? 'active' : ''}`}
                    style={{ padding: '6px 14px', fontSize: 12, borderRadius: 20 }}
                    onClick={() => setStaffOrderFilter(statusKey)}
                  >
                    {label} ({count})
                  </button>
                ))}
              </div>

              <div className="table-responsive">
                <table className="finset-table">
                  <thead>
                    <tr>
                      <th>ORDER #</th>
                      <th>CUSTOMER & CONTACT</th>
                      <th>EQUIPMENT</th>
                      <th>DATES</th>
                      <th>TOTAL DUE</th>
                      <th>STATUS</th>
                      <th>ACTIONS / DECISION</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredStaffOrders.map((ord) => {
                      const totalDue = getOrderTotal(ord);
                      const equipName = formatOrderEquipmentLabel(ord);
                      const canEditItems = ord.status === 'draft' || ord.status === 'confirmed';
                      return (
                        <tr key={ord.id}>
                          <td>
                            <strong>{ord.order_number}</strong>
                          </td>
                          <td>
                            <div>
                              <strong>{ord.customer?.full_name || 'Customer'}</strong>
                            </div>
                            <small style={{ color: 'var(--text-muted)' }}>
                              {ord.customer?.phone
                                ? formatPhilippinePhone(ord.customer.phone)
                                : ord.special_terms || 'No phone'}
                            </small>
                          </td>
                          <td>
                            <div>{equipName}</div>
                            {canEditItems && (
                              <button
                                type="button"
                                className="outline-pill-btn"
                                style={{ padding: '3px 8px', fontSize: 10, marginTop: 4 }}
                                onClick={() => openManageOrderItems(ord)}
                                title="Edit item price/days, add items, or remove items in rental_order_items"
                              >
                                📋 Manage Items ({ord.items?.length || 0})
                              </button>
                            )}
                          </td>
                          <td>
                            <div>
                              {ord.expected_start_date} &rarr; {ord.expected_end_date}
                            </div>
                            {ord.status === 'confirmed' && ord.expected_end_date < todayDate && (
                              <small style={{ color: '#dc2626', fontWeight: 700, fontSize: 10 }}>
                                ⚠ End date passed
                              </small>
                            )}
                          </td>
                          <td>
                            <div style={{ fontWeight: 800, color: 'var(--purple-main)' }}>
                              {formatPHP(totalDue)}
                            </div>
                            <small
                              style={{
                                fontSize: 10,
                                fontWeight: 700,
                                color:
                                  ord.payment_status === 'paid'
                                    ? '#047857'
                                    : ord.payment_status === 'partially_paid'
                                      ? '#b45309'
                                      : '#6b7280',
                              }}
                            >
                              {ord.payment_status.toUpperCase()}
                            </small>
                          </td>
                          <td>
                            {ord.status === 'draft' ? (
                              <span className="pending-status-badge">⏳ Pending Review</span>
                            ) : ord.status === 'confirmed' ? (
                              <span className="confirmed-status-badge">✓ Confirmed</span>
                            ) : ord.status === 'in_progress' ? (
                              <span className="in-progress-status-badge">📦 Out on Rent</span>
                            ) : ord.status === 'completed' ? (
                              <span className="completed-status-badge">✓ Completed</span>
                            ) : (
                              <span className="cancelled-status-badge">Cancelled</span>
                            )}
                          </td>
                          <td>
                            <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                              {ord.status !== 'cancelled' && ord.payment_status !== 'paid' && (
                                <button
                                  type="button"
                                  className="outline-pill-btn"
                                  style={{ padding: '4px 10px', fontSize: 11 }}
                                  onClick={() => {
                                    setPayingOrder(ord);
                                    setPaymentAmount(String(totalDue));
                                    setPaymentMethod('cash');
                                  }}
                                  title="Record payment in payment_transactions"
                                >
                                  💳 Pay
                                </button>
                              )}
                              {ord.status === 'draft' ? (
                                <>
                                  <button
                                    className="approve-btn"
                                    onClick={() => handleApproveReservation(ord.id)}
                                    disabled={reservationUpdating}
                                    title="Approve Customer Booking"
                                  >
                                    ✓ Approve
                                  </button>
                                  <button
                                    className="reject-btn"
                                    onClick={() => handleRejectReservation(ord.id)}
                                    disabled={reservationUpdating}
                                    title="Reject Booking Request"
                                  >
                                    ✕ Reject
                                  </button>
                                </>
                              ) : ord.status === 'confirmed' ? (
                                ord.expected_end_date < todayDate ? (
                                  <>
                                    <button
                                      className="primary-purple-btn"
                                      style={{ padding: '5px 10px', fontSize: 11 }}
                                      onClick={() => handleRescheduleAndDispatch(ord)}
                                      disabled={reservationUpdating}
                                      title="Shift rental start date to today for the booked duration and dispatch now"
                                    >
                                      ↻ Move to Today &amp; Dispatch
                                    </button>
                                    <button
                                      className="reject-btn"
                                      onClick={() => handleCancelExpiredOrder(ord.id)}
                                      disabled={reservationUpdating}
                                      title="Cancel expired reservation"
                                    >
                                      ✕ Cancel
                                    </button>
                                  </>
                                ) : (
                                  <button
                                    className="primary-purple-btn"
                                    style={{ padding: '5px 12px', fontSize: 11 }}
                                    onClick={() => handleDispatchCheckout(ord.id)}
                                    title="Hand off equipment to customer"
                                  >
                                    Dispatch &rarr;
                                  </button>
                                )
                              ) : ord.status === 'in_progress' ? (
                                <span style={{ fontSize: 11, color: '#1d4ed8', fontWeight: 600 }}>
                                  Out with Customer
                                </span>
                              ) : ord.status === 'completed' ? (
                                <span style={{ fontSize: 11, color: '#047857', fontWeight: 700 }}>
                                  ✓ Completed
                                </span>
                              ) : (
                                <span style={{ fontSize: 11, color: '#9ca3af' }}>Cancelled</span>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                    {filteredStaffOrders.length === 0 && (
                      <tr>
                        <td colSpan={7} style={{ textAlign: 'center', padding: 30, color: 'var(--text-muted)' }}>
                          No orders matching this filter.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* TAB 6: DISPATCH & CHECKOUT (STAFF) */}
          {currentRole === 'staff' && activeTab === 'Dispatch & Checkout' && (
            <div className="transactions-table-card" style={{ marginTop: 6 }}>
              <div className="table-card-header">
                <div>
                  <h3 className="chart-card-title">Dispatch &amp; Equipment Handoff</h3>
                  <p style={{ margin: '4px 0 0', fontSize: 12, color: 'var(--text-muted)' }}>
                    Use this tab when a customer arrives to pick up (or receive) an approved reservation. Clicking
                    Complete Dispatch marks the equipment as Rented / Out with Customer.
                  </p>
                </div>
              </div>

              <div className="table-responsive">
                <table className="finset-table">
                  <thead>
                    <tr>
                      <th>ORDER NUMBER</th>
                      <th>EQUIPMENT</th>
                      <th>CUSTOMER</th>
                      <th>RENTAL DATES</th>
                      <th>STATUS</th>
                      <th>ACTION</th>
                    </tr>
                  </thead>
                  <tbody>
                    {orders
                      .filter(
                        (ord) =>
                          ord.status === 'confirmed' ||
                          ord.status === 'in_progress' ||
                          ord.status === 'completed'
                      )
                      .sort((a, b) => {
                        const rank = (s: string) =>
                          s === 'confirmed' ? 0 : s === 'in_progress' ? 1 : 2;
                        return rank(a.status) - rank(b.status);
                      })
                      .map((ord) => {
                        const isExpired = ord.status === 'confirmed' && ord.expected_end_date < todayDate;
                        const equipLabel = formatOrderEquipmentLabel(ord);
                        return (
                          <tr key={ord.id}>
                            <td>
                              <strong>{ord.order_number}</strong>
                            </td>
                            <td>
                              <strong>{equipLabel}</strong>
                            </td>
                            <td>
                              <div>
                                <strong>{ord.customer?.full_name || '—'}</strong>
                              </div>
                              <small style={{ color: 'var(--text-muted)' }}>
                                {ord.customer?.phone ? formatPhilippinePhone(ord.customer.phone) : '—'}
                              </small>
                            </td>
                            <td>
                              <div>
                                {ord.expected_start_date} &rarr; {ord.expected_end_date}
                              </div>
                              {isExpired && (
                                <small
                                  style={{
                                    display: 'inline-block',
                                    marginTop: 3,
                                    color: '#dc2626',
                                    fontWeight: 700,
                                    fontSize: 11,
                                  }}
                                >
                                  ⚠ Rental end date passed — reschedule to today or cancel
                                </small>
                              )}
                            </td>
                            <td>
                              {ord.status === 'confirmed' ? (
                                isExpired ? (
                                  <span className="cancelled-status-badge">Dates Expired</span>
                                ) : (
                                  <span className="confirmed-status-badge">Ready for Pickup</span>
                                )
                              ) : ord.status === 'in_progress' ? (
                                <span className="in-progress-status-badge">Out with Customer</span>
                              ) : (
                                <span className="completed-status-badge">✓ Completed</span>
                              )}
                            </td>
                            <td>
                              {ord.status === 'confirmed' ? (
                                isExpired ? (
                                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                                    <button
                                      className="primary-purple-btn"
                                      style={{ padding: '6px 12px', fontSize: 11 }}
                                      onClick={() => handleRescheduleAndDispatch(ord)}
                                      disabled={reservationUpdating}
                                      title="Move rental dates to start today and dispatch immediately"
                                    >
                                      ↻ Move to Today &amp; Dispatch
                                    </button>
                                    <button
                                      className="reject-btn"
                                      onClick={() => handleCancelExpiredOrder(ord.id)}
                                      disabled={reservationUpdating}
                                      title="Cancel expired order"
                                    >
                                      ✕ Cancel Order
                                    </button>
                                  </div>
                                ) : (
                                  <button
                                    className="primary-purple-btn"
                                    style={{ padding: '6px 14px', fontSize: 11 }}
                                    onClick={() => handleDispatchCheckout(ord.id)}
                                  >
                                    Complete Dispatch
                                  </button>
                                )
                              ) : ord.status === 'in_progress' ? (
                                <span style={{ color: '#1d4ed8', fontSize: 11, fontWeight: 600 }}>
                                  Handed Off (Active)
                                </span>
                              ) : (
                                <span style={{ color: '#047857', fontSize: 11, fontWeight: 700 }}>
                                  ✓ Completed
                                </span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    {orders.filter(
                      (ord) =>
                        ord.status === 'confirmed' ||
                        ord.status === 'in_progress' ||
                        ord.status === 'completed'
                    ).length === 0 && (
                      <tr>
                        <td colSpan={6} style={{ textAlign: 'center', padding: 30, color: 'var(--text-muted)' }}>
                          No orders currently awaiting dispatch.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* TAB 7: RETURN & INSPECTION (CHECK-IN WHEN CUSTOMER RETURNS EQUIPMENT) */}
          {currentRole === 'staff' && activeTab === 'Return & Inspection' && (
            <div className="transactions-table-card" style={{ marginTop: 6 }}>
              <div className="table-card-header">
                <div>
                  <h3 className="chart-card-title">Equipment Returns &amp; Check-In</h3>
                  <p style={{ margin: '4px 0 0', fontSize: 12, color: 'var(--text-muted)' }}>
                    Click Return Equipment when a customer brings gear back. Returned as Okay sets the item back to
                    Available immediately; Returned as Damaged sends it to Maintenance Queue.
                  </p>
                </div>
              </div>

              <div className="table-responsive">
                <table className="finset-table">
                  <thead>
                    <tr>
                      <th>ORDER #</th>
                      <th>EQUIPMENT</th>
                      <th>CUSTOMER</th>
                      <th>RENTAL DATES</th>
                      <th>STATUS</th>
                      <th>RETURN ACTION</th>
                    </tr>
                  </thead>
                  <tbody>
                    {returnableOrderItems.map((row) => (
                      <tr key={row.itemId}>
                        <td>
                          <strong>{row.orderNumber}</strong>
                        </td>
                        <td>
                          <div>
                            <strong>{row.equipmentName}</strong>
                          </div>
                          <small style={{ color: 'var(--text-muted)' }}>S/N: {row.serialNumber}</small>
                        </td>
                        <td>
                          <div>
                            <strong>{row.customerName}</strong>
                          </div>
                          {row.customerPhone && (
                            <small style={{ color: 'var(--text-muted)' }}>
                              {formatPhilippinePhone(row.customerPhone)}
                            </small>
                          )}
                        </td>
                        <td>
                          {row.startDate} &rarr; {row.endDate}
                        </td>
                        <td>
                          {row.itemStatus === 'dispatched' ? (
                            <span className="in-progress-status-badge">Out with Customer</span>
                          ) : (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 3, alignItems: 'flex-start' }}>
                              <span className="completed-status-badge">✓ Completed</span>
                              <small
                                style={{
                                  fontSize: 10,
                                  fontWeight: 700,
                                  color: row.itemStatus === 'damaged' ? '#b45309' : '#047857',
                                }}
                              >
                                {row.itemStatus === 'damaged'
                                  ? 'Returned Damaged (In Maintenance)'
                                  : 'Returned Okay (Available)'}
                              </small>
                            </div>
                          )}
                        </td>
                        <td>
                          {row.itemStatus === 'dispatched' ? (
                            <button
                              className="primary-purple-btn"
                              style={{ padding: '6px 14px', fontSize: 11 }}
                              onClick={() => {
                                setReturningItemId(row.itemId);
                                setReturnCondition('okay');
                                setDamageNotes('');
                                setPenaltyFee('');
                                setReturnPhysicallyReceived(false);
                              }}
                            >
                              Return Equipment
                            </button>
                          ) : (
                            <span style={{ color: '#047857', fontSize: 11, fontWeight: 700 }}>
                              ✓ Completed
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                    {returnableOrderItems.length === 0 && (
                      <tr>
                        <td colSpan={6} style={{ textAlign: 'center', padding: 30, color: 'var(--text-muted)' }}>
                          No dispatched or returned equipment yet. Dispatch a confirmed order first.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              {inspections.length > 0 && (
                <div style={{ marginTop: 22, borderTop: '1px solid var(--border-subtle)', paddingTop: 16 }}>
                  <h4 style={{ margin: '0 0 10px', fontSize: 14, fontWeight: 800, color: '#111827' }}>
                    Saved Check-In Inspection Records ({inspections.length})
                  </h4>
                  <div className="table-responsive">
                    <table className="finset-table">
                      <thead>
                        <tr>
                          <th>INSPECTION ID</th>
                          <th>INSPECTOR</th>
                          <th>CLEANLINESS</th>
                          <th>INTEGRITY</th>
                          <th>RESULT</th>
                          <th>PENALTY</th>
                          <th>NOTES</th>
                        </tr>
                      </thead>
                      <tbody>
                        {inspections.slice(0, 12).map((ins) => (
                          <tr key={ins.id}>
                            <td>
                              <code>{ins.id.slice(0, 8)}</code>
                            </td>
                            <td>{ins.inspector?.full_name || 'Staff'}</td>
                            <td>{ins.cleanliness_rating}/5</td>
                            <td>{ins.structural_integrity_rating}/5</td>
                            <td>
                              {ins.damage_identified ? (
                                <span className="cancelled-status-badge">Damaged</span>
                              ) : (
                                <span className="confirmed-status-badge">Okay</span>
                              )}
                            </td>
                            <td>{formatPHP(ins.penalty_fee)}</td>
                            <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                              {ins.damage_assessment_notes || 'Clean check-in'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* TAB 8: ADMIN BORROWED & RETURNED ITEMS TRACKING */}
          {currentRole === 'admin' && activeTab === 'Borrowed & Returned Items' && (
            <div className="transactions-table-card" style={{ marginTop: 6 }}>
              <div className="table-card-header">
                <div>
                  <h3 className="chart-card-title">Borrowed & Returned Equipment Tracking</h3>
                </div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <button
                    className={`auth-tab-btn-finset ${adminBorrowedTab === 'borrowed' ? 'active' : ''}`}
                    style={{ padding: '6px 14px', fontSize: 12, borderRadius: 20 }}
                    onClick={() => setAdminBorrowedTab('borrowed')}
                  >
                    Borrowed Items ({borrowedItems.length})
                  </button>
                  <button
                    className={`auth-tab-btn-finset ${adminBorrowedTab === 'returned' ? 'active' : ''}`}
                    style={{ padding: '6px 14px', fontSize: 12, borderRadius: 20 }}
                    onClick={() => setAdminBorrowedTab('returned')}
                  >
                    Returned Items ({returnedItems.length})
                  </button>
                  <button
                    className={`auth-tab-btn-finset ${adminBorrowedTab === 'orders' ? 'active' : ''}`}
                    style={{ padding: '6px 14px', fontSize: 12, borderRadius: 20 }}
                    onClick={() => setAdminBorrowedTab('orders')}
                  >
                    Orders &amp; Payments ({orders.length})
                  </button>
                </div>
              </div>

              {adminBorrowedTab === 'orders' ? (
                <div>
                  <div className="table-responsive">
                    <table className="finset-table">
                      <thead>
                        <tr>
                          <th>ORDER #</th>
                          <th>CUSTOMER</th>
                          <th>ORDER ITEMS</th>
                          <th>DATES</th>
                          <th>TOTAL DUE</th>
                          <th>PAYMENT</th>
                          <th>STATUS</th>
                          <th>ACTIONS</th>
                        </tr>
                      </thead>
                      <tbody>
                        {orders.map((ord) => {
                          const totalDue = getOrderTotal(ord);
                          const canEditItems = ord.status === 'draft' || ord.status === 'confirmed';
                          return (
                            <tr key={ord.id}>
                              <td>
                                <strong>{ord.order_number}</strong>
                              </td>
                              <td>{ord.customer?.full_name || 'Customer'}</td>
                              <td>{formatOrderEquipmentLabel(ord)}</td>
                              <td>
                                {ord.expected_start_date} &rarr; {ord.expected_end_date}
                              </td>
                              <td style={{ fontWeight: 800, color: 'var(--purple-main)' }}>
                                {formatPHP(totalDue)}
                              </td>
                              <td>
                                <span
                                  className={
                                    ord.payment_status === 'paid'
                                      ? 'confirmed-status-badge'
                                      : 'pending-status-badge'
                                  }
                                >
                                  {ord.payment_status.toUpperCase()}
                                </span>
                              </td>
                              <td>
                                {ord.status === 'completed' ? (
                                  <span className="completed-status-badge">✓ Completed</span>
                                ) : ord.status === 'in_progress' ? (
                                  <span className="in-progress-status-badge">Dispatched</span>
                                ) : ord.status === 'confirmed' ? (
                                  <span className="confirmed-status-badge">Confirmed</span>
                                ) : ord.status === 'draft' ? (
                                  <span className="pending-status-badge">Pending</span>
                                ) : (
                                  <span className="cancelled-status-badge">Cancelled</span>
                                )}
                              </td>
                              <td>
                                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                                  {canEditItems && (
                                    <button
                                      type="button"
                                      className="outline-pill-btn"
                                      style={{ padding: '4px 10px', fontSize: 11 }}
                                      onClick={() => openManageOrderItems(ord)}
                                    >
                                      📋 Items ({ord.items?.length || 0})
                                    </button>
                                  )}
                                  {ord.status !== 'cancelled' && ord.payment_status !== 'paid' && (
                                    <button
                                      type="button"
                                      className="outline-pill-btn"
                                      style={{ padding: '4px 10px', fontSize: 11 }}
                                      onClick={() => {
                                        setPayingOrder(ord);
                                        setPaymentAmount(String(totalDue));
                                        setPaymentMethod('cash');
                                      }}
                                    >
                                      💳 Record Payment
                                    </button>
                                  )}
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>

                  {payments.length > 0 && (
                    <div style={{ marginTop: 22, borderTop: '1px solid var(--border-subtle)', paddingTop: 16 }}>
                      <h4 style={{ margin: '0 0 10px', fontSize: 14, fontWeight: 800, color: '#111827' }}>
                        Payment Transactions Ledger ({payments.length})
                      </h4>
                      <div className="table-responsive">
                        <table className="finset-table">
                          <thead>
                            <tr>
                              <th>REFERENCE</th>
                              <th>METHOD</th>
                              <th>AMOUNT</th>
                              <th>STATUS</th>
                              <th>PROCESSED AT</th>
                            </tr>
                          </thead>
                          <tbody>
                            {payments.slice(0, 15).map((pt) => (
                              <tr key={pt.id}>
                                <td>
                                  <code>{pt.transaction_reference}</code>
                                </td>
                                <td style={{ textTransform: 'uppercase', fontSize: 11, fontWeight: 700 }}>
                                  {pt.payment_method.replace('_', ' ')}
                                </td>
                                <td style={{ fontWeight: 800, color: '#047857' }}>
                                  {formatPHP(pt.amount)}
                                </td>
                                <td>
                                  <span className="confirmed-status-badge">
                                    {pt.transaction_status}
                                  </span>
                                </td>
                                <td>{new Date(pt.processed_at).toLocaleString()}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                </div>
              ) : adminBorrowedTab === 'borrowed' ? (
                <div className="table-responsive">
                  <table className="finset-table">
                    <thead>
                      <tr>
                        <th>EQUIPMENT</th>
                        <th>SERIAL #</th>
                        <th>BORROWER / CUSTOMER</th>
                        <th>PHONE</th>
                        <th>START DATE</th>
                        <th>RETURN DUE DATE</th>
                        <th>STATUS</th>
                      </tr>
                    </thead>
                    <tbody>
                      {borrowedItems.map((b) => (
                        <tr key={b.itemId}>
                          <td>
                            <strong>{b.equipmentName}</strong>
                          </td>
                          <td>
                            <code>{b.serialNumber}</code>
                          </td>
                          <td>{b.customerName}</td>
                          <td>{formatPhilippinePhone(b.customerPhone)}</td>
                          <td>{b.startDate}</td>
                          <td>
                            <strong style={{ color: b.endDate < todayDate ? '#dc2626' : '#111827' }}>
                              {b.endDate} {b.endDate < todayDate ? '(OVERDUE)' : ''}
                            </strong>
                          </td>
                          <td>
                            <span className="in-progress-status-badge">On Rent</span>
                          </td>
                        </tr>
                      ))}
                      {borrowedItems.length === 0 && (
                        <tr>
                          <td colSpan={7} style={{ textAlign: 'center', padding: 30, color: 'var(--text-muted)' }}>
                            No equipment is currently borrowed.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="table-responsive">
                  <table className="finset-table">
                    <thead>
                      <tr>
                        <th>ORDER #</th>
                        <th>EQUIPMENT</th>
                        <th>SERIAL #</th>
                        <th>CUSTOMER</th>
                        <th>RETURN DATE</th>
                        <th>STATUS</th>
                        <th>RETURN CONDITION</th>
                      </tr>
                    </thead>
                    <tbody>
                      {returnedItems.map((r) => (
                        <tr key={r.itemId}>
                          <td>
                            <strong>{r.orderNumber}</strong>
                          </td>
                          <td>
                            <strong>{r.equipmentName}</strong>
                          </td>
                          <td>
                            <code>{r.serialNumber}</code>
                          </td>
                          <td>{r.customerName}</td>
                          <td>{r.returnDate}</td>
                          <td>
                            <span className="completed-status-badge">✓ Completed</span>
                          </td>
                          <td>
                            {r.status === 'damaged' ? (
                              <span className="cancelled-status-badge">Returned as Damaged</span>
                            ) : (
                              <span className="confirmed-status-badge">Returned as Okay</span>
                            )}
                          </td>
                        </tr>
                      ))}
                      {returnedItems.length === 0 && (
                        <tr>
                          <td colSpan={7} style={{ textAlign: 'center', padding: 30, color: 'var(--text-muted)' }}>
                            No returned equipment records found.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* TAB 9: ADMIN USER MANAGEMENT (REMOVE STAFF & CUSTOMER, ADD STAFF) */}
          {currentRole === 'admin' && activeTab === 'User Management' && (
            <div className="transactions-table-card" style={{ marginTop: 6 }}>
              <div className="table-card-header">
                <div>
                  <h3 className="chart-card-title">User Accounts Control</h3>
                </div>

                <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button
                      className={`auth-tab-btn-finset ${adminUserTab === 'staff' ? 'active' : ''}`}
                      style={{ padding: '6px 14px', fontSize: 12, borderRadius: 20 }}
                      onClick={() => setAdminUserTab('staff')}
                    >
                      Staff Members ({usersList.filter((u) => u.role === 'staff').length})
                    </button>
                    <button
                      className={`auth-tab-btn-finset ${adminUserTab === 'customer' ? 'active' : ''}`}
                      style={{ padding: '6px 14px', fontSize: 12, borderRadius: 20 }}
                      onClick={() => setAdminUserTab('customer')}
                    >
                      Customers ({usersList.filter((u) => u.role === 'customer').length})
                    </button>
                  </div>

                  {adminUserTab === 'staff' && (
                    <button
                      className="primary-purple-btn"
                      onClick={() => setIsAddStaffOpen(true)}
                      style={{ padding: '8px 16px', fontSize: 12 }}
                    >
                      + Add Staff Member
                    </button>
                  )}

                  <input
                    type="text"
                    placeholder="Search users..."
                    value={userSearch}
                    onChange={(e) => setUserSearch(e.target.value)}
                    style={{
                      padding: '8px 14px',
                      borderRadius: 16,
                      border: '1px solid var(--border-subtle)',
                      fontSize: 12,
                      outline: 'none',
                    }}
                  />
                </div>
              </div>

              <div className="table-responsive">
                <table className="finset-table">
                  <thead>
                    <tr>
                      <th>NAME</th>
                      <th>EMAIL</th>
                      <th>PHONE</th>
                      <th>COMPANY</th>
                      <th>ROLE</th>
                      <th>JOINED</th>
                      <th>ACTION</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredUsers.map((user) => (
                      <tr key={user.id}>
                        <td>
                          <strong>{user.full_name}</strong>
                        </td>
                        <td>{user.email}</td>
                        <td>{formatPhilippinePhone(user.phone)}</td>
                        <td>{user.company_name || '—'}</td>
                        <td>
                          <span
                            style={{
                              padding: '3px 10px',
                              borderRadius: 12,
                              background: user.role === 'staff' ? '#eff6ff' : '#ecfdf5',
                              color: user.role === 'staff' ? '#1d4ed8' : '#047857',
                              fontSize: 10,
                              fontWeight: 700,
                              textTransform: 'uppercase',
                            }}
                          >
                            {user.role}
                          </span>
                        </td>
                        <td>{user.created_at ? user.created_at.slice(0, 10) : '—'}</td>
                        <td>
                          {/* Cannot delete admin; can remove staff and customers */}
                          {user.role === 'admin' ? (
                            <span style={{ fontSize: 11, color: '#9ca3af', fontWeight: 600 }}>
                              Primary Admin
                            </span>
                          ) : (
                            <button
                              className="delete-action-btn"
                              onClick={() => handleDeleteUser(user.id, user.full_name, user.role)}
                              title={`Remove ${user.role}`}
                            >
                              Remove {user.role === 'staff' ? 'Staff' : 'Customer'}
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                    {filteredUsers.length === 0 && (
                      <tr>
                        <td colSpan={7} style={{ textAlign: 'center', padding: 30, color: 'var(--text-muted)' }}>
                          No users found matching this filter.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* TAB 10: MAINTENANCE QUEUE & OVERSIGHT */}
          {currentRole !== 'customer' &&
            (activeTab === 'Maintenance Oversight' || activeTab === 'Maintenance Queue') && (
            <div className="transactions-table-card" style={{ marginTop: 6 }}>
              <div className="table-card-header">
                <div>
                  <h3 className="chart-card-title">Equipment Maintenance &amp; Repairs</h3>
                  <p style={{ margin: '4px 0 0', fontSize: 12, color: 'var(--text-muted)' }}>
                    Equipment under maintenance cannot be toggled directly in Inventory. Click Mark as Repaired below
                    to complete the repair and automatically set the item back to Available in Inventory.
                  </p>
                </div>
              </div>

              <div className="table-responsive">
                <table className="finset-table">
                  <thead>
                    <tr>
                      <th>WORK ORDER</th>
                      <th>EQUIPMENT</th>
                      <th>SERIAL #</th>
                      <th>ISSUE / NOTES</th>
                      <th>TASKS &amp; COST</th>
                      <th>DATE</th>
                      <th>STATUS</th>
                      <th>ACTION</th>
                    </tr>
                  </thead>
                  <tbody>
                    {maintenanceQueueItems.map((m) => {
                      const isOpen = m.status === 'pending' || m.status === 'in_progress';
                      const busyKey = m.maintenanceId || m.equipmentId;
                      const isUpdating = maintenanceUpdatingId === busyKey;
                      return (
                        <tr key={m.key}>
                          <td>
                            <strong>{m.workOrderNumber}</strong>
                          </td>
                          <td>
                            <strong>{m.equipmentName}</strong>
                          </td>
                          <td>
                            <code>{m.serialNumber}</code>
                          </td>
                          <td style={{ maxWidth: 240, fontSize: 12, color: '#374151' }}>{m.notes}</td>
                          <td>
                            <div style={{ fontWeight: 700, fontSize: 12 }}>
                              {formatPHP(m.totalCost)}
                            </div>
                            {m.maintenanceId && (
                              <button
                                type="button"
                                className="outline-pill-btn"
                                style={{ padding: '3px 8px', fontSize: 10, marginTop: 3 }}
                                onClick={() => setManagingMaintId(m.maintenanceId!)}
                                title="View, add, or remove technician tasks in maintenance_tasks"
                              >
                                📋 Tasks ({m.tasks.length})
                              </button>
                            )}
                          </td>
                          <td>{m.scheduledDate}</td>
                          <td>
                            {isOpen ? (
                              <span className="pending-status-badge">Under Maintenance</span>
                            ) : m.status === 'completed' ? (
                              <span className="confirmed-status-badge">Repaired</span>
                            ) : (
                              <span className="cancelled-status-badge">{m.status}</span>
                            )}
                          </td>
                          <td>
                            {isOpen ? (
                              <button
                                className="approve-btn"
                                style={{ padding: '6px 14px', fontSize: 11 }}
                                onClick={() =>
                                  handleMarkMaintenanceFixed(m.equipmentId, m.maintenanceId)
                                }
                                disabled={isUpdating}
                              >
                                {isUpdating ? 'Updating...' : '✓ Mark as Repaired'}
                              </button>
                            ) : (
                              <span style={{ fontSize: 11, color: '#047857', fontWeight: 700 }}>
                                ✓ Repaired (Available in Inventory)
                              </span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                    {maintenanceQueueItems.length === 0 && (
                      <tr>
                        <td colSpan={8} style={{ textAlign: 'center', padding: 30, color: 'var(--text-muted)' }}>
                          No equipment is currently under maintenance.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* TAB 11: AUDIT LOGS */}
          {currentRole === 'admin' && activeTab === 'Engine Audit Logs' && (
            <div className="transactions-table-card" style={{ marginTop: 6 }}>
              <div className="table-card-header">
                <div>
                  <h3 className="chart-card-title">System Audit Log</h3>
                </div>
              </div>
              <div className="table-responsive">
                <table className="finset-table">
                  <thead>
                    <tr>
                      <th>TIMESTAMP</th>
                      <th>OPERATION</th>
                      <th>TARGET TABLE</th>
                      <th>RECORD ID</th>
                    </tr>
                  </thead>
                  <tbody>
                    {auditLogs.map((log) => (
                      <tr key={log.id}>
                        <td>{new Date(log.executed_at).toLocaleString()}</td>
                        <td>
                          <strong>{log.action_type}</strong>
                        </td>
                        <td>{log.table_name}</td>
                        <td>
                          <code>{log.record_id?.slice(0, 8)}</code>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* TAB 12: MY PROFILE */}
          {activeTab === 'My Profile' && (
            <div className="profile-management-grid">
              <div className="profile-summary-card">
                <div className="profile-avatar-big">
                  {activeUser.full_name
                    .split(/\s+/)
                    .filter(Boolean)
                    .slice(0, 2)
                    .map((part) => part[0]?.toUpperCase())
                    .join('')}
                </div>
                <h3 style={{ margin: '0 0 4px', fontSize: 18, fontWeight: 800, color: '#111827' }}>
                  {activeUser.full_name}
                </h3>
                <p style={{ margin: '0 0 12px', fontSize: 12, color: 'var(--text-muted)' }}>
                  {activeUser.email}
                </p>

                <span
                  style={{
                    padding: '4px 14px',
                    borderRadius: 16,
                    background: 'var(--purple-light)',
                    color: 'var(--purple-main)',
                    fontSize: 11,
                    fontWeight: 800,
                    textTransform: 'uppercase',
                    marginBottom: 16,
                  }}
                >
                  {currentRole}
                </span>

                <div
                  style={{
                    width: '100%',
                    borderTop: '1px solid var(--border-subtle)',
                    paddingTop: 16,
                    fontSize: 12,
                    textAlign: 'left',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 8,
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ color: 'var(--text-muted)' }}>Account Status:</span>
                    <strong style={{ color: activeUser.account_status === 'active' ? '#047857' : '#b91c1c' }}>
                      {activeUser.account_status}
                    </strong>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ color: 'var(--text-muted)' }}>Contact:</span>
                    <strong>{formatPhilippinePhone(activeUser.phone)}</strong>
                  </div>
                </div>
              </div>

              <div className="profile-form-card">
                <div style={{ marginBottom: 20 }}>
                  <h3 className="chart-card-title">Profile Details</h3>
                </div>

                <form onSubmit={handleProfileUpdate} className="auth-form-finset">
                  <div className="form-row">
                    <div className="form-group">
                      <label>Full Name</label>
                      <input
                        type="text"
                        value={profileName}
                        onChange={(e) => setProfileName(e.target.value)}
                        required
                      />
                    </div>

                    <div className="form-group">
                      <label>Email</label>
                      <input
                        type="email"
                        value={activeUser.email}
                        disabled
                        style={{ opacity: 0.65, cursor: 'not-allowed' }}
                      />
                    </div>
                  </div>

                  <div className="form-row">
                    <div className="form-group">
                      <label>Phone</label>
                      <input
                        type="tel"
                        value={profilePhone}
                        onChange={(e) => setProfilePhone(e.target.value)}
                        required
                      />
                    </div>

                    <div className="form-group">
                      <label>Company / Studio</label>
                      <input
                        type="text"
                        value={profileCompany}
                        onChange={(e) => setProfileCompany(e.target.value)}
                      />
                    </div>
                  </div>

                  <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 14 }}>
                    <button type="submit" className="primary-purple-btn" disabled={profileSaving}>
                      {profileSaving ? 'Saving Changes...' : 'Save Profile Changes'}
                    </button>
                  </div>
                </form>
              </div>
            </div>
          )}

          {/* MOBILE BOTTOM NAVIGATION BAR */}
          <nav className="mobile-bottom-nav">
            <button
              className={`mobile-nav-item ${activeTab === 'Dashboard' ? 'active' : ''}`}
              onClick={() => setActiveTab('Dashboard')}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="3" y="3" width="7" height="7" rx="1.5" />
                <rect x="14" y="3" width="7" height="7" rx="1.5" />
                <rect x="14" y="14" width="7" height="7" rx="1.5" />
                <rect x="3" y="14" width="7" height="7" rx="1.5" />
              </svg>
              <span>Home</span>
            </button>

            <button
              className={`mobile-nav-item ${activeTab === 'Browse Equipment' || activeTab === 'Fleet Inventory' ? 'active' : ''}`}
              onClick={() => setActiveTab(currentRole === 'customer' ? 'Browse Equipment' : 'Fleet Inventory')}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21 12V7H5a2 2 0 0 1 0-4h14v4" />
                <path d="M3 5v14a2 2 0 0 0 2 2h16v-5" />
                <path d="M18 12a2 2 0 0 0 0 4h4v-4Z" />
              </svg>
              <span>Fleet</span>
            </button>

            {currentRole === 'customer' ? (
              <button
                className={`mobile-nav-item ${activeTab === 'My Reservations' ? 'active' : ''}`}
                onClick={() => setActiveTab('My Reservations')}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <rect x="2" y="5" width="20" height="14" rx="3" />
                  <line x1="2" y1="10" x2="22" y2="10" />
                </svg>
                <span>Orders</span>
              </button>
            ) : currentRole === 'staff' ? (
              <button
                className={`mobile-nav-item ${activeTab === 'Orders & Requests' ? 'active' : ''}`}
                onClick={() => setActiveTab('Orders & Requests')}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                  <polyline points="14 2 14 8 20 8" />
                  <line x1="16" y1="13" x2="8" y2="13" />
                  <line x1="16" y1="17" x2="8" y2="17" />
                </svg>
                <span>Orders</span>
              </button>
            ) : (
              <button
                className={`mobile-nav-item ${activeTab === 'User Management' ? 'active' : ''}`}
                onClick={() => setActiveTab('User Management')}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                  <circle cx="9" cy="7" r="4" />
                  <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
                  <path d="M16 3.13a4 4 0 0 1 0 7.75" />
                </svg>
                <span>Users</span>
              </button>
            )}

            <button
              className={`mobile-nav-item ${activeTab === 'My Profile' ? 'active' : ''}`}
              onClick={() => setActiveTab('My Profile')}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                <circle cx="12" cy="7" r="4" />
              </svg>
              <span>Profile</span>
            </button>

            <button className="mobile-nav-item" onClick={handleLogout} style={{ color: '#dc2626' }}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                <polyline points="16 17 21 12 16 7" />
                <line x1="21" y1="12" x2="9" y2="12" />
              </svg>
              <span>Log out</span>
            </button>
          </nav>
        </main>
      </div>

      {/* MODAL 1: RESERVE EQUIPMENT (WITH CUSTOMER NAME, PHONE, FUTURE DATES, ACCURATE TOTAL DUE) */}
      {rentingEquipment && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(30, 20, 60, 0.45)',
            backdropFilter: 'blur(6px)',
            display: 'grid',
            placeItems: 'center',
            zIndex: 1000,
            padding: 18,
          }}
        >
          <div
            style={{
              background: '#ffffff',
              borderRadius: 32,
              padding: 34,
              maxWidth: 520,
              width: '100%',
              boxShadow: '0 25px 70px rgba(0,0,0,0.22)',
            }}
          >
            <h2 style={{ fontSize: 22, fontWeight: 800, margin: '0 0 6px', color: '#111827' }}>
              {currentRole === 'staff'
                ? `Rent for Customer: ${rentingEquipment.model_name}`
                : `Confirm Reservation: ${rentingEquipment.model_name}`}
            </h2>
            <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '0 0 18px' }}>
              {formatPHP(rentingEquipment.daily_rental_rate)}/day &bull; Value: {formatPHP(rentingEquipment.replacement_value)}
            </p>

            <form onSubmit={handleBookingSubmit} className="auth-form-finset">
              {currentRole === 'staff' && (
                <>
                  <div className="form-group">
                    <label>Select Equipment</label>
                    <select
                      className="filter-select-pill"
                      style={{ width: '100%', borderRadius: 12, padding: 10 }}
                      value={rentingEquipment.id}
                      onChange={(e) => {
                        const chosen = availableEquipment.find((eq) => eq.id === e.target.value);
                        if (chosen) {
                          setRentingEquipment(chosen);
                          const nextOpen = findNextAvailableDate(chosen.id);
                          if (bookStartDate < todayDate || getEquipmentBlockOnDate(chosen.id, bookStartDate)) {
                            setBookStartDate(nextOpen);
                          }
                        }
                      }}
                    >
                      {availableEquipment.map((eq) => (
                        <option key={eq.id} value={eq.id}>
                          {eq.model_name} ({formatPHP(eq.daily_rental_rate)}/day)
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="form-group">
                    <label>Select Customer Account</label>
                    {customerAccounts.length > 0 ? (
                      <select
                        className="filter-select-pill"
                        style={{ width: '100%', borderRadius: 12, padding: 10 }}
                        value={bookSelectedCustomerId}
                        onChange={(e) => {
                          const custId = e.target.value;
                          setBookSelectedCustomerId(custId);
                          const cust = customerAccounts.find((c) => c.id === custId);
                          if (cust) {
                            setBookCustomerName(cust.full_name);
                            setBookCustomerPhone(cust.phone);
                          }
                        }}
                        required
                      >
                        {customerAccounts.map((cust) => (
                          <option key={cust.id} value={cust.id}>
                            {cust.full_name} ({cust.email})
                          </option>
                        ))}
                      </select>
                    ) : (
                      <div
                        role="alert"
                        style={{
                          padding: '8px 12px',
                          borderRadius: 10,
                          background: 'var(--red-bg)',
                          color: 'var(--red-kpi)',
                          fontSize: 11,
                          fontWeight: 700,
                        }}
                      >
                        No active customer accounts found yet. Ask the customer to create a Customer account first.
                      </div>
                    )}
                  </div>
                </>
              )}

              <div className="form-row">
                <div className="form-group">
                  <label>Customer Name</label>
                  <input
                    type="text"
                    required
                    placeholder="Full Name"
                    value={bookCustomerName}
                    onChange={(e) => setBookCustomerName(e.target.value)}
                  />
                </div>
                <div className="form-group">
                  <label>Contact Number</label>
                  <input
                    type="tel"
                    required
                    placeholder="+63 912 345 6789"
                    value={bookCustomerPhone}
                    onChange={(e) => setBookCustomerPhone(e.target.value)}
                  />
                </div>
              </div>

              <div className="form-row">
                <div className="form-group">
                  <label>Rental Start Date</label>
                  <input
                    type="date"
                    min={todayDate}
                    value={bookStartDate}
                    onChange={(e) => {
                      const val = e.target.value;
                      if (val && val < todayDate) {
                        showToast(`Past dates are not allowed. Minimum rental start date is ${todayDate}.`);
                      }
                      setBookStartDate(val);
                    }}
                    required
                  />
                  <small style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                    Today ({todayDate}) or future dates only
                  </small>
                </div>

                <div className="form-group">
                  <label>Duration (Days)</label>
                  <input
                    type="number"
                    min="1"
                    max="30"
                    placeholder="e.g. 3"
                    value={bookDays}
                    onChange={(e) => setBookDays(e.target.value)}
                    required
                  />
                </div>
              </div>

              <div className="form-group">
                <label>Shoot Location / Delivery Address</label>
                <input
                  type="text"
                  placeholder="e.g. Studio B, Quezon City"
                  value={bookAddress}
                  onChange={(e) => setBookAddress(e.target.value)}
                  required
                />
              </div>

              {/* Real-time calculated price summary */}
              <div
                style={{
                  background: '#fafaff',
                  border: '1px solid var(--border-subtle)',
                  padding: 16,
                  borderRadius: 16,
                  fontSize: 12,
                  margin: '6px 0 16px',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5 }}>
                  <span>Rental Period</span>
                  <strong>
                    {bookStartDate} &rarr; {bookingEndDate || '—'} ({bookDays || '—'} days)
                  </strong>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5 }}>
                  <span>Daily Rate</span>
                  <strong>{formatPHP(rentingEquipment.daily_rental_rate)}/day</strong>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5 }}>
                  <span>Subtotal</span>
                  <strong>{formatPHP(bookingSubtotal)}</strong>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5 }}>
                  <span>Insurance</span>
                  <span>{formatPHP(bookingInsurance)}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5 }}>
                  <span>Tax (8%)</span>
                  <span>{formatPHP(bookingTax)}</span>
                </div>
                <hr style={{ border: 0, borderTop: '1px solid var(--border-subtle)', margin: '10px 0' }} />
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    fontSize: 15,
                    fontWeight: 800,
                    color: 'var(--purple-main)',
                  }}
                >
                  <span>Total Due</span>
                  <span>{formatPHP(bookingTotal)}</span>
                </div>
                {bookingPastDateError ? (
                  <div
                    role="alert"
                    style={{
                      marginTop: 10,
                      padding: '8px 12px',
                      borderRadius: 10,
                      background: 'var(--red-bg)',
                      color: 'var(--red-kpi)',
                      fontSize: 11,
                      fontWeight: 700,
                    }}
                  >
                    ⚠️ Invalid Date: Reservations on previous dates are not allowed. Choose {todayDate} or a future
                    date.
                  </div>
                ) : bookingOverlapReason ? (
                  <div
                    role="alert"
                    style={{
                      marginTop: 10,
                      padding: '8px 12px',
                      borderRadius: 10,
                      background: 'var(--red-bg)',
                      color: 'var(--red-kpi)',
                      fontSize: 11,
                      fontWeight: 700,
                    }}
                  >
                    ⚠️ Unavailable: Another reservation or maintenance block already covers{' '}
                    {bookStartDate}
                    {bookingEndDate && bookingEndDate !== bookStartDate ? ` to ${bookingEndDate}` : ''}.
                    Please select different dates.
                  </div>
                ) : currentRole === 'staff' ? (
                  <div style={{ marginTop: 8, fontSize: 11, color: '#047857', fontWeight: 700 }}>
                    ✓ Staff Booking: Order will be Confirmed immediately and ready for Dispatch &amp; Checkout
                  </div>
                ) : (
                  <div style={{ marginTop: 8, fontSize: 11, color: '#b45309', fontWeight: 600 }}>
                    ⏳ Status will be set to Pending after confirmation
                  </div>
                )}
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
                <button
                  type="button"
                  className="outline-pill-btn"
                  onClick={() => setRentingEquipment(null)}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="primary-purple-btn"
                  disabled={
                    bookingPastDateError ||
                    Boolean(bookingOverlapReason) ||
                    (currentRole === 'staff' && !bookSelectedCustomerId)
                  }
                  style={{
                    opacity:
                      bookingPastDateError ||
                      Boolean(bookingOverlapReason) ||
                      (currentRole === 'staff' && !bookSelectedCustomerId)
                        ? 0.5
                        : 1,
                    cursor:
                      bookingPastDateError ||
                      Boolean(bookingOverlapReason) ||
                      (currentRole === 'staff' && !bookSelectedCustomerId)
                        ? 'not-allowed'
                        : 'pointer',
                  }}
                >
                  {currentRole === 'staff'
                    ? 'Confirm Rental for Customer'
                    : 'Confirm Reservation Request'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 2: RETURN EQUIPMENT CHECK-IN (OKAY -> AVAILABLE | DAMAGED -> UNDER MAINTENANCE) */}
      {returningItemId && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(30, 20, 60, 0.45)',
            backdropFilter: 'blur(6px)',
            display: 'grid',
            placeItems: 'center',
            zIndex: 1000,
            padding: 18,
          }}
        >
          <div
            style={{
              background: '#ffffff',
              borderRadius: 32,
              padding: 34,
              maxWidth: 520,
              width: '100%',
              boxShadow: '0 25px 70px rgba(0,0,0,0.22)',
            }}
          >
            {(() => {
              const returningRow = returnableOrderItems.find((r) => r.itemId === returningItemId);
              return (
                <>
                  <h2 style={{ fontSize: 22, fontWeight: 800, margin: '0 0 6px', color: '#111827' }}>
                    Return Equipment Check-In
                  </h2>
                  <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '0 0 16px' }}>
                    {returningRow
                      ? `${returningRow.equipmentName} (${returningRow.orderNumber}) — ${returningRow.customerName}`
                      : 'Verify returned equipment condition.'}
                  </p>
                </>
              );
            })()}

            <form onSubmit={handleReturnSubmit} className="auth-form-finset">
              {/* Mandatory Physical Return Checkbox */}
              <div
                style={{
                  background: '#fef3c7',
                  border: '1px solid #fde68a',
                  padding: 14,
                  borderRadius: 14,
                  marginBottom: 16,
                }}
              >
                <label
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    fontSize: 12,
                    fontWeight: 700,
                    color: '#92400e',
                    cursor: 'pointer',
                  }}
                >
                  <input
                    type="checkbox"
                    checked={returnPhysicallyReceived}
                    onChange={(e) => setReturnPhysicallyReceived(e.target.checked)}
                    style={{ width: 18, height: 18, cursor: 'pointer' }}
                  />
                  <span>I confirm the customer has physically returned this equipment.</span>
                </label>
              </div>

              {/* Explicit Return Condition Selector: Okay vs Damaged */}
              <div className="form-group">
                <label>Return Condition</label>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 4 }}>
                  <button
                    type="button"
                    onClick={() => {
                      setReturnCondition('okay');
                      setPenaltyFee('');
                    }}
                    style={{
                      padding: '14px 12px',
                      borderRadius: 14,
                      border:
                        returnCondition === 'okay'
                          ? '2px solid #059669'
                          : '1px solid var(--border-subtle)',
                      background: returnCondition === 'okay' ? '#ecfdf5' : '#ffffff',
                      color: returnCondition === 'okay' ? '#065f46' : '#374151',
                      textAlign: 'left',
                      cursor: 'pointer',
                    }}
                  >
                    <div style={{ fontWeight: 800, fontSize: 13, marginBottom: 4 }}>
                      ✓ Returned as Okay
                    </div>
                    <div style={{ fontSize: 11, opacity: 0.85, lineHeight: 1.35 }}>
                      Good condition — automatically becomes <strong>Available</strong>
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() => setReturnCondition('damaged')}
                    style={{
                      padding: '14px 12px',
                      borderRadius: 14,
                      border:
                        returnCondition === 'damaged'
                          ? '2px solid #dc2626'
                          : '1px solid var(--border-subtle)',
                      background: returnCondition === 'damaged' ? '#fef2f2' : '#ffffff',
                      color: returnCondition === 'damaged' ? '#991b1b' : '#374151',
                      textAlign: 'left',
                      cursor: 'pointer',
                    }}
                  >
                    <div style={{ fontWeight: 800, fontSize: 13, marginBottom: 4 }}>
                      ⚠ Returned as Damaged
                    </div>
                    <div style={{ fontSize: 11, opacity: 0.85, lineHeight: 1.35 }}>
                      Needs repair — automatically set to <strong>Under Maintenance</strong>
                    </div>
                  </button>
                </div>
              </div>

              <div className="form-group">
                <label>
                  {returnCondition === 'damaged'
                    ? 'Damage / Issue Description'
                    : 'Check-In Notes (Optional)'}
                </label>
                <textarea
                  rows={2}
                  placeholder={
                    returnCondition === 'damaged'
                      ? 'e.g. Scratched lens element, missing battery door, gimbal motor issue...'
                      : 'Optional return notes (e.g. Complete kit with battery & charger)...'
                  }
                  value={damageNotes}
                  onChange={(e) => setDamageNotes(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '8px 12px',
                    borderRadius: 12,
                    border: '1px solid var(--border-subtle)',
                    fontSize: 12,
                  }}
                />
              </div>

              {returnCondition === 'damaged' && (
                <div className="form-group">
                  <label>Damage Penalty Fee (PHP, Optional)</label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    placeholder="0.00"
                    value={penaltyFee}
                    onChange={(e) => setPenaltyFee(e.target.value)}
                  />
                </div>
              )}

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 16 }}>
                <button
                  type="button"
                  className="outline-pill-btn"
                  onClick={() => setReturningItemId(null)}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="primary-purple-btn"
                  disabled={!returnPhysicallyReceived}
                  style={{
                    opacity: returnPhysicallyReceived ? 1 : 0.5,
                    background: returnCondition === 'damaged' ? '#dc2626' : undefined,
                  }}
                >
                  {returnCondition === 'damaged'
                    ? '⚠ Return as Damaged (Send to Maintenance)'
                    : '✓ Return as Okay (Set Available)'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 3: ADMIN ADD EQUIPMENT */}
      {isAddEquipmentOpen && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(30, 20, 60, 0.45)',
            backdropFilter: 'blur(6px)',
            display: 'grid',
            placeItems: 'center',
            zIndex: 1000,
            padding: 18,
          }}
        >
          <div
            style={{
              background: '#ffffff',
              borderRadius: 32,
              padding: 34,
              maxWidth: 550,
              width: '100%',
              boxShadow: '0 25px 70px rgba(0,0,0,0.22)',
            }}
          >
            <h2 style={{ fontSize: 22, fontWeight: 800, margin: '0 0 6px', color: '#111827' }}>
              Add New Equipment to Catalog
            </h2>
            <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '0 0 18px' }}>
              Add cameras, lenses, lighting, audio, or studio gear to the rental catalog.
            </p>

            <form onSubmit={handleCreateEquipment} className="auth-form-finset">
              <div className="form-row">
                <div className="form-group">
                  <label>Model Name</label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. Sony Alpha A7 IV Mirrorless Camera"
                    value={eqModelName}
                    onChange={(e) => setEqModelName(e.target.value)}
                  />
                </div>
                <div className="form-group">
                  <label>Manufacturer / Brand</label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. Sony, Canon, DJI, Aputure"
                    value={eqManufacturer}
                    onChange={(e) => setEqManufacturer(e.target.value)}
                  />
                </div>
              </div>

              <div className="form-row">
                <div className="form-group">
                  <label>Serial Number (Unique)</label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. CAM-SN-A7IV-02"
                    value={eqSerialNumber}
                    onChange={(e) => setEqSerialNumber(e.target.value)}
                  />
                </div>
                <div className="form-group">
                  <label>Model Year</label>
                  <input
                    type="number"
                    min="1995"
                    max="2030"
                    value={eqModelYear}
                    onChange={(e) => setEqModelYear(e.target.value)}
                    required
                  />
                </div>
              </div>

              <div className="form-row">
                <div className="form-group">
                  <label>Daily Rental Rate (PHP)</label>
                  <input
                    type="number"
                    min="1"
                    step="0.01"
                    placeholder="e.g. 2500"
                    value={eqDailyRate}
                    onChange={(e) => setEqDailyRate(e.target.value)}
                    required
                  />
                </div>
                <div className="form-group">
                  <label>Replacement Value (PHP)</label>
                  <input
                    type="number"
                    min="1"
                    step="0.01"
                    placeholder="e.g. 145000"
                    value={eqReplacementVal}
                    onChange={(e) => setEqReplacementVal(e.target.value)}
                    required
                  />
                </div>
              </div>

              <div className="form-row">
                <div className="form-group">
                  <label>Category</label>
                  <select
                    className="filter-select-pill"
                    style={{ width: '100%', borderRadius: 12, padding: 10 }}
                    value={eqCategoryId}
                    onChange={(e) => setEqCategoryId(e.target.value)}
                  >
                    {categoriesList.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.category_name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="form-group">
                  <label>Pickup Hub / Studio Branch</label>
                  <select
                    className="filter-select-pill"
                    style={{ width: '100%', borderRadius: 12, padding: 10 }}
                    value={eqWarehouseId}
                    onChange={(e) => setEqWarehouseId(e.target.value)}
                  >
                    {warehousesList.map((w) => (
                      <option key={w.id} value={w.id}>
                        {w.branch_name} ({w.city})
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="form-group">
                <label>Equipment Image URL (Optional)</label>
                <input
                  type="url"
                  placeholder="https://images.unsplash.com/..."
                  value={eqImageUrl}
                  onChange={(e) => setEqImageUrl(e.target.value)}
                />
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 14 }}>
                <button
                  type="button"
                  className="outline-pill-btn"
                  onClick={() => setIsAddEquipmentOpen(false)}
                >
                  Cancel
                </button>
                <button type="submit" className="primary-purple-btn">
                  Save Equipment
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 4: ADMIN EDIT EQUIPMENT */}
      {editingEquipment && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(30, 20, 60, 0.45)',
            backdropFilter: 'blur(6px)',
            display: 'grid',
            placeItems: 'center',
            zIndex: 1000,
            padding: 18,
          }}
        >
          <div
            style={{
              background: '#ffffff',
              borderRadius: 32,
              padding: 34,
              maxWidth: 550,
              width: '100%',
              boxShadow: '0 25px 70px rgba(0,0,0,0.22)',
            }}
          >
            <h2 style={{ fontSize: 22, fontWeight: 800, margin: '0 0 6px', color: '#111827' }}>
              Edit Equipment Details
            </h2>
            <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '0 0 18px' }}>
              Update specs, rates, or metadata for {editingEquipment.model_name}.
            </p>

            <form onSubmit={handleUpdateEquipment} className="auth-form-finset">
              <div className="form-row">
                <div className="form-group">
                  <label>Model Name</label>
                  <input
                    type="text"
                    required
                    value={eqModelName}
                    onChange={(e) => setEqModelName(e.target.value)}
                  />
                </div>
                <div className="form-group">
                  <label>Manufacturer</label>
                  <input
                    type="text"
                    required
                    value={eqManufacturer}
                    onChange={(e) => setEqManufacturer(e.target.value)}
                  />
                </div>
              </div>

              <div className="form-row">
                <div className="form-group">
                  <label>Daily Rental Rate (PHP)</label>
                  <input
                    type="number"
                    min="1"
                    step="0.01"
                    value={eqDailyRate}
                    onChange={(e) => setEqDailyRate(e.target.value)}
                    required
                  />
                </div>
                <div className="form-group">
                  <label>Replacement Value (PHP)</label>
                  <input
                    type="number"
                    min="1"
                    step="0.01"
                    value={eqReplacementVal}
                    onChange={(e) => setEqReplacementVal(e.target.value)}
                    required
                  />
                </div>
              </div>

              <div className="form-row">
                <div className="form-group">
                  <label>Category</label>
                  <select
                    className="filter-select-pill"
                    style={{ width: '100%', borderRadius: 12, padding: 10 }}
                    value={eqCategoryId}
                    onChange={(e) => setEqCategoryId(e.target.value)}
                  >
                    {categoriesList.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.category_name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="form-group">
                  <label>Pickup Hub / Studio Branch</label>
                  <select
                    className="filter-select-pill"
                    style={{ width: '100%', borderRadius: 12, padding: 10 }}
                    value={eqWarehouseId}
                    onChange={(e) => setEqWarehouseId(e.target.value)}
                  >
                    {warehousesList.map((w) => (
                      <option key={w.id} value={w.id}>
                        {w.branch_name} ({w.city})
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="form-group">
                <label>Image URL</label>
                <input
                  type="url"
                  value={eqImageUrl}
                  onChange={(e) => setEqImageUrl(e.target.value)}
                />
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 14 }}>
                <button
                  type="button"
                  className="outline-pill-btn"
                  onClick={() => setEditingEquipment(null)}
                >
                  Cancel
                </button>
                <button type="submit" className="primary-purple-btn">
                  Update Changes
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 5: ADMIN ADD STAFF MEMBER */}
      {isAddStaffOpen && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(30, 20, 60, 0.45)',
            backdropFilter: 'blur(6px)',
            display: 'grid',
            placeItems: 'center',
            zIndex: 1000,
            padding: 18,
          }}
        >
          <div
            style={{
              background: '#ffffff',
              borderRadius: 32,
              padding: 34,
              maxWidth: 500,
              width: '100%',
              boxShadow: '0 25px 70px rgba(0,0,0,0.22)',
            }}
          >
            <h2 style={{ fontSize: 22, fontWeight: 800, margin: '0 0 6px', color: '#111827' }}>
              Add New Staff Member
            </h2>
            <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '0 0 18px' }}>
              Staff accounts are created exclusively by the Administrator.
            </p>

            <form onSubmit={handleAddStaffSubmit} className="auth-form-finset">
              <div className="form-group">
                <label>Full Name</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Maria Santos"
                  value={staffFullName}
                  onChange={(e) => setStaffFullName(e.target.value)}
                />
              </div>

              <div className="form-group">
                <label>Staff Email</label>
                <input
                  type="email"
                  required
                  placeholder="staff@equiprent.com"
                  value={staffEmail}
                  onChange={(e) => setStaffEmail(e.target.value)}
                />
              </div>

              <div className="form-group">
                <label>Contact Phone</label>
                <input
                  type="tel"
                  required
                  placeholder="+63 912 345 6789"
                  value={staffPhone}
                  onChange={(e) => setStaffPhone(e.target.value)}
                  onBlur={() => setStaffPhone((val) => formatPhilippinePhone(val))}
                />
              </div>

              <div className="form-group">
                <label>Initial Temporary Password</label>
                <input
                  type="password"
                  required
                  placeholder="At least 6 characters"
                  value={staffPassword}
                  onChange={(e) => setStaffPassword(e.target.value)}
                />
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 14 }}>
                <button
                  type="button"
                  className="outline-pill-btn"
                  onClick={() => setIsAddStaffOpen(false)}
                >
                  Cancel
                </button>
                <button type="submit" className="primary-purple-btn" disabled={staffSaving}>
                  {staffSaving ? 'Creating Staff Member...' : 'Create Staff Account'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 6: MANAGE RENTAL ORDER ITEMS (rental_order_items <-> rental_orders LIVE SYNC) */}
      {managingOrderId &&
        (() => {
          const targetOrd = orders.find((o) => o.id === managingOrderId);
          if (!targetOrd) return null;
          const existingEquipIds = new Set((targetOrd.items || []).map((i) => i.equipment_id));
          return (
            <div
              style={{
                position: 'fixed',
                inset: 0,
                background: 'rgba(30, 20, 60, 0.45)',
                backdropFilter: 'blur(6px)',
                display: 'grid',
                placeItems: 'center',
                zIndex: 1000,
                padding: 18,
              }}
            >
              <div
                style={{
                  background: '#ffffff',
                  borderRadius: 28,
                  padding: 28,
                  maxWidth: 680,
                  width: '100%',
                  maxHeight: '88vh',
                  overflowY: 'auto',
                  boxShadow: '0 25px 70px rgba(0,0,0,0.22)',
                }}
              >
                <h2 style={{ fontSize: 20, fontWeight: 800, margin: '0 0 4px', color: '#111827' }}>
                  Manage Order Items — {targetOrd.order_number}
                </h2>
                <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '0 0 16px' }}>
                  Changes save directly to <code>rental_order_items</code> and automatically recalculate{' '}
                  <code>rental_orders</code> totals ({formatPHP(getOrderTotal(targetOrd))}).
                </p>

                <div className="table-responsive" style={{ marginBottom: 18 }}>
                  <table className="finset-table">
                    <thead>
                      <tr>
                        <th>EQUIPMENT</th>
                        <th>RATE / DAY (PHP)</th>
                        <th>DAYS</th>
                        <th>SUBTOTAL</th>
                        <th>ACTIONS</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(targetOrd.items || []).map((item) => {
                        const draft = itemEditDrafts[item.id] || {
                          rate: String(item.unit_daily_rate),
                          days: String(item.days_rented),
                        };
                        const previewSub =
                          (Number(draft.rate) || 0) * Math.max(1, Number(draft.days) || 1);
                        return (
                          <tr key={item.id}>
                            <td>
                              <strong>{item.equipment?.model_name || 'Equipment'}</strong>
                            </td>
                            <td>
                              <input
                                type="number"
                                min="1"
                                step="0.01"
                                value={draft.rate}
                                onChange={(e) =>
                                  setItemEditDrafts((prev) => ({
                                    ...prev,
                                    [item.id]: { ...draft, rate: e.target.value },
                                  }))
                                }
                                style={{
                                  width: 100,
                                  padding: '5px 8px',
                                  borderRadius: 8,
                                  border: '1px solid var(--border-subtle)',
                                  fontSize: 12,
                                }}
                              />
                            </td>
                            <td>
                              <input
                                type="number"
                                min="1"
                                max="30"
                                value={draft.days}
                                onChange={(e) =>
                                  setItemEditDrafts((prev) => ({
                                    ...prev,
                                    [item.id]: { ...draft, days: e.target.value },
                                  }))
                                }
                                style={{
                                  width: 64,
                                  padding: '5px 8px',
                                  borderRadius: 8,
                                  border: '1px solid var(--border-subtle)',
                                  fontSize: 12,
                                }}
                              />
                            </td>
                            <td style={{ fontWeight: 700 }}>{formatPHP(previewSub)}</td>
                            <td>
                              <div style={{ display: 'flex', gap: 6 }}>
                                <button
                                  type="button"
                                  className="approve-btn"
                                  style={{ padding: '4px 10px', fontSize: 11 }}
                                  disabled={orderItemSaving}
                                  onClick={() => handleSaveOrderItemEdit(targetOrd, item.id)}
                                >
                                  Save
                                </button>
                                <button
                                  type="button"
                                  className="delete-action-btn"
                                  style={{ padding: '4px 10px', fontSize: 11 }}
                                  disabled={orderItemSaving}
                                  onClick={() => handleRemoveOrderItem(targetOrd.id, item.id)}
                                >
                                  Delete
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                <form
                  onSubmit={(e) => handleAddOrderItemSubmit(e, targetOrd)}
                  className="auth-form-finset"
                  style={{
                    background: '#fafaff',
                    border: '1px solid var(--border-subtle)',
                    borderRadius: 16,
                    padding: 16,
                  }}
                >
                  <h4 style={{ margin: '0 0 10px', fontSize: 13, fontWeight: 800, color: '#111827' }}>
                    + Add Equipment Item to Order
                  </h4>
                  <div className="form-row">
                    <div className="form-group">
                      <label>Available Equipment</label>
                      <select
                        className="filter-select-pill"
                        style={{ width: '100%', borderRadius: 12, padding: 8 }}
                        value={newOrderItemEquipId}
                        onChange={(e) => {
                          const id = e.target.value;
                          setNewOrderItemEquipId(id);
                          const eq = availableEquipment.find((x) => x.id === id);
                          if (eq) setNewOrderItemRate(String(eq.daily_rental_rate));
                        }}
                      >
                        <option value="">-- Select equipment --</option>
                        {availableEquipment
                          .filter((eq) => !existingEquipIds.has(eq.id))
                          .map((eq) => (
                            <option key={eq.id} value={eq.id}>
                              {eq.model_name} ({formatPHP(eq.daily_rental_rate)}/day)
                            </option>
                          ))}
                      </select>
                    </div>
                    <div className="form-group">
                      <label>Rate / Day (PHP)</label>
                      <input
                        type="number"
                        min="1"
                        step="0.01"
                        value={newOrderItemRate}
                        onChange={(e) => setNewOrderItemRate(e.target.value)}
                        required
                      />
                    </div>
                    <div className="form-group">
                      <label>Days</label>
                      <input
                        type="number"
                        min="1"
                        max="30"
                        value={newOrderItemDays}
                        onChange={(e) => setNewOrderItemDays(e.target.value)}
                        required
                      />
                    </div>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 10 }}>
                    <button
                      type="button"
                      className="outline-pill-btn"
                      onClick={() => setManagingOrderId(null)}
                    >
                      Close
                    </button>
                    <button
                      type="submit"
                      className="primary-purple-btn"
                      disabled={orderItemSaving || !newOrderItemEquipId}
                    >
                      + Add Item to Order
                    </button>
                  </div>
                </form>
              </div>
            </div>
          );
        })()}

      {/* MODAL 7: RECORD PAYMENT TRANSACTION (payment_transactions <-> rental_orders.payment_status) */}
      {payingOrder && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(30, 20, 60, 0.45)',
            backdropFilter: 'blur(6px)',
            display: 'grid',
            placeItems: 'center',
            zIndex: 1000,
            padding: 18,
          }}
        >
          <div
            style={{
              background: '#ffffff',
              borderRadius: 28,
              padding: 28,
              maxWidth: 460,
              width: '100%',
              boxShadow: '0 25px 70px rgba(0,0,0,0.22)',
            }}
          >
            <h2 style={{ fontSize: 20, fontWeight: 800, margin: '0 0 4px', color: '#111827' }}>
              Record Order Payment
            </h2>
            <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '0 0 16px' }}>
              {payingOrder.order_number} &bull; Total Due: {formatPHP(getOrderTotal(payingOrder))}
            </p>
            <form onSubmit={handleRecordPaymentSubmit} className="auth-form-finset">
              <div className="form-group">
                <label>Payment Method</label>
                <select
                  className="filter-select-pill"
                  style={{ width: '100%', borderRadius: 12, padding: 10 }}
                  value={paymentMethod}
                  onChange={(e) => setPaymentMethod(e.target.value as PaymentMethod)}
                >
                  <option value="cash">Cash</option>
                  <option value="credit_card">Credit Card</option>
                  <option value="bank_transfer">Bank Transfer</option>
                  <option value="corporate_credit">Corporate Credit</option>
                </select>
              </div>
              <div className="form-group">
                <label>Amount Paid (PHP)</label>
                <input
                  type="number"
                  min="1"
                  step="0.01"
                  value={paymentAmount}
                  onChange={(e) => setPaymentAmount(e.target.value)}
                  required
                />
              </div>
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 14 }}>
                <button
                  type="button"
                  className="outline-pill-btn"
                  onClick={() => setPayingOrder(null)}
                >
                  Cancel
                </button>
                <button type="submit" className="primary-purple-btn" disabled={paymentSaving}>
                  {paymentSaving ? 'Recording...' : 'Save Payment'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 8: SEND EQUIPMENT TO MAINTENANCE (equipment + maintenance_records + maintenance_tasks) */}
      {maintTargetEquip && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(30, 20, 60, 0.45)',
            backdropFilter: 'blur(6px)',
            display: 'grid',
            placeItems: 'center',
            zIndex: 1000,
            padding: 18,
          }}
        >
          <div
            style={{
              background: '#ffffff',
              borderRadius: 28,
              padding: 28,
              maxWidth: 500,
              width: '100%',
              boxShadow: '0 25px 70px rgba(0,0,0,0.22)',
            }}
          >
            <h2 style={{ fontSize: 20, fontWeight: 800, margin: '0 0 4px', color: '#111827' }}>
              Log Maintenance Work Order
            </h2>
            <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '0 0 16px' }}>
              {maintTargetEquip.model_name} (S/N: {maintTargetEquip.serial_number})
            </p>
            <form onSubmit={handleSendToMaintenanceSubmit} className="auth-form-finset">
              <div className="form-group">
                <label>Maintenance Type</label>
                <select
                  className="filter-select-pill"
                  style={{ width: '100%', borderRadius: 12, padding: 10 }}
                  value={maintType}
                  onChange={(e) => setMaintType(e.target.value as MaintenanceType)}
                >
                  <option value="scheduled_routine">Scheduled Routine Calibration</option>
                  <option value="emergency_repair">Emergency Repair</option>
                  <option value="post_rental_inspection">Post-Rental Inspection</option>
                  <option value="major_overhaul">Major Overhaul</option>
                </select>
              </div>
              <div className="form-group">
                <label>Service / Issue Description</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Sensor cleaning & shutter calibration"
                  value={maintDesc}
                  onChange={(e) => setMaintDesc(e.target.value)}
                />
              </div>
              <div className="form-group">
                <label>Initial Repair Task Name</label>
                <input
                  type="text"
                  required
                  value={maintTaskName}
                  onChange={(e) => setMaintTaskName(e.target.value)}
                />
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label>Estimated Hours</label>
                  <input
                    type="number"
                    min="0.5"
                    step="0.5"
                    value={maintHours}
                    onChange={(e) => setMaintHours(e.target.value)}
                    required
                  />
                </div>
                <div className="form-group">
                  <label>Hourly Labor Rate (PHP)</label>
                  <input
                    type="number"
                    min="1"
                    step="0.01"
                    value={maintHourlyRate}
                    onChange={(e) => setMaintHourlyRate(e.target.value)}
                    required
                  />
                </div>
              </div>
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 14 }}>
                <button
                  type="button"
                  className="outline-pill-btn"
                  onClick={() => setMaintTargetEquip(null)}
                >
                  Cancel
                </button>
                <button type="submit" className="primary-purple-btn" disabled={maintSaving}>
                  {maintSaving ? 'Saving...' : 'Send to Maintenance'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 9: MANAGE MAINTENANCE TASKS (maintenance_tasks <-> maintenance_records COST SYNC) */}
      {managingMaintId &&
        (() => {
          const targetMaint = maintenance.find((m) => m.id === managingMaintId);
          if (!targetMaint) return null;
          const isOpen =
            targetMaint.maintenance_status === 'pending' ||
            targetMaint.maintenance_status === 'in_progress';
          return (
            <div
              style={{
                position: 'fixed',
                inset: 0,
                background: 'rgba(30, 20, 60, 0.45)',
                backdropFilter: 'blur(6px)',
                display: 'grid',
                placeItems: 'center',
                zIndex: 1000,
                padding: 18,
              }}
            >
              <div
                style={{
                  background: '#ffffff',
                  borderRadius: 28,
                  padding: 28,
                  maxWidth: 640,
                  width: '100%',
                  maxHeight: '88vh',
                  overflowY: 'auto',
                  boxShadow: '0 25px 70px rgba(0,0,0,0.22)',
                }}
              >
                <h2 style={{ fontSize: 20, fontWeight: 800, margin: '0 0 4px', color: '#111827' }}>
                  Repair Tasks — {targetMaint.work_order_number}
                </h2>
                <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '0 0 16px' }}>
                  Total Work Order Cost: <strong>{formatPHP(targetMaint.total_maintenance_cost)}</strong>
                </p>

                <div className="table-responsive" style={{ marginBottom: 16 }}>
                  <table className="finset-table">
                    <thead>
                      <tr>
                        <th>CODE</th>
                        <th>TASK</th>
                        <th>HOURS &times; RATE</th>
                        <th>COST</th>
                        <th>STATUS</th>
                        {isOpen && <th>ACTION</th>}
                      </tr>
                    </thead>
                    <tbody>
                      {(targetMaint.tasks || []).map((t) => (
                        <tr key={t.id}>
                          <td>
                            <code>{t.task_code}</code>
                          </td>
                          <td>
                            <div>
                              <strong>{t.task_name}</strong>
                            </div>
                            {t.findings_report && (
                              <small style={{ color: 'var(--text-muted)' }}>
                                {t.findings_report}
                              </small>
                            )}
                          </td>
                          <td>
                            {t.hours_logged}h &times; {formatPHP(t.hourly_labor_rate)}
                          </td>
                          <td style={{ fontWeight: 700 }}>{formatPHP(t.task_cost)}</td>
                          <td>
                            <span
                              className={
                                t.progress_status === 'completed'
                                  ? 'confirmed-status-badge'
                                  : 'pending-status-badge'
                              }
                            >
                              {t.progress_status}
                            </span>
                          </td>
                          {isOpen && (
                            <td>
                              <button
                                type="button"
                                className="delete-action-btn"
                                style={{ padding: '4px 10px', fontSize: 11 }}
                                onClick={() => handleRemoveMaintTask(t.id, targetMaint.id)}
                              >
                                Remove
                              </button>
                            </td>
                          )}
                        </tr>
                      ))}
                      {(targetMaint.tasks || []).length === 0 && (
                        <tr>
                          <td colSpan={6} style={{ textAlign: 'center', padding: 18, color: 'var(--text-muted)' }}>
                            No tasks logged yet.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>

                {isOpen ? (
                  <form
                    onSubmit={handleAddMaintTaskSubmit}
                    className="auth-form-finset"
                    style={{
                      background: '#fafaff',
                      border: '1px solid var(--border-subtle)',
                      borderRadius: 16,
                      padding: 16,
                    }}
                  >
                    <h4 style={{ margin: '0 0 10px', fontSize: 13, fontWeight: 800 }}>
                      + Add Repair Task to maintenance_tasks
                    </h4>
                    <div className="form-row">
                      <div className="form-group">
                        <label>Task Name</label>
                        <input
                          type="text"
                          required
                          placeholder="e.g. Replace shutter flex cable"
                          value={newTaskName}
                          onChange={(e) => setNewTaskName(e.target.value)}
                        />
                      </div>
                      <div className="form-group">
                        <label>Hours</label>
                        <input
                          type="number"
                          min="0.5"
                          step="0.5"
                          value={newTaskHours}
                          onChange={(e) => setNewTaskHours(e.target.value)}
                          required
                        />
                      </div>
                      <div className="form-group">
                        <label>Rate / Hr (PHP)</label>
                        <input
                          type="number"
                          min="1"
                          step="0.01"
                          value={newTaskRate}
                          onChange={(e) => setNewTaskRate(e.target.value)}
                          required
                        />
                      </div>
                    </div>
                    <div className="form-group">
                      <label>Findings / Notes (Optional)</label>
                      <input
                        type="text"
                        placeholder="Technician notes..."
                        value={newTaskReport}
                        onChange={(e) => setNewTaskReport(e.target.value)}
                      />
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 10 }}>
                      <button
                        type="button"
                        className="outline-pill-btn"
                        onClick={() => setManagingMaintId(null)}
                      >
                        Close
                      </button>
                      <button type="submit" className="primary-purple-btn" disabled={taskSaving}>
                        {taskSaving ? 'Adding...' : '+ Save Task'}
                      </button>
                    </div>
                  </form>
                ) : (
                  <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                    <button
                      type="button"
                      className="outline-pill-btn"
                      onClick={() => setManagingMaintId(null)}
                    >
                      Close
                    </button>
                  </div>
                )}
              </div>
            </div>
          );
        })()}

      {/* MODAL 10: ADMIN MANAGE EQUIPMENT CATEGORIES (equipment_categories) */}
      {isManageCategoriesOpen && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(30, 20, 60, 0.45)',
            backdropFilter: 'blur(6px)',
            display: 'grid',
            placeItems: 'center',
            zIndex: 1000,
            padding: 18,
          }}
        >
          <div
            style={{
              background: '#ffffff',
              borderRadius: 28,
              padding: 28,
              maxWidth: 600,
              width: '100%',
              maxHeight: '88vh',
              overflowY: 'auto',
              boxShadow: '0 25px 70px rgba(0,0,0,0.22)',
            }}
          >
            <h2 style={{ fontSize: 20, fontWeight: 800, margin: '0 0 12px', color: '#111827' }}>
              Equipment Categories ({categoriesList.length})
            </h2>
            <div className="table-responsive" style={{ marginBottom: 16 }}>
              <table className="finset-table">
                <thead>
                  <tr>
                    <th>CODE</th>
                    <th>CATEGORY NAME</th>
                    <th>INSURANCE / DAY</th>
                    <th>ACTION</th>
                  </tr>
                </thead>
                <tbody>
                  {categoriesList.map((c) => (
                    <tr key={c.id}>
                      <td>
                        <code>{c.category_code}</code>
                      </td>
                      <td>
                        <strong>{c.category_name}</strong>
                      </td>
                      <td>{formatPHP(c.base_daily_insurance_rate)}</td>
                      <td>
                        <button
                          type="button"
                          className="delete-action-btn"
                          style={{ padding: '4px 10px', fontSize: 11 }}
                          onClick={() => handleDeleteCategory(c.id, c.category_name)}
                        >
                          Delete
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <form onSubmit={handleCreateCategorySubmit} className="auth-form-finset">
              <div className="form-row">
                <div className="form-group">
                  <label>Category Name</label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. Action Cameras"
                    value={catName}
                    onChange={(e) => setCatName(e.target.value)}
                  />
                </div>
                <div className="form-group">
                  <label>Code (Unique)</label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. ACT-CAM"
                    value={catCode}
                    onChange={(e) => setCatCode(e.target.value)}
                  />
                </div>
                <div className="form-group">
                  <label>Daily Insurance (PHP)</label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={catInsuranceRate}
                    onChange={(e) => setCatInsuranceRate(e.target.value)}
                    required
                  />
                </div>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 12 }}>
                <button
                  type="button"
                  className="outline-pill-btn"
                  onClick={() => setIsManageCategoriesOpen(false)}
                >
                  Close
                </button>
                <button type="submit" className="primary-purple-btn">
                  + Add Category
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 11: ADMIN MANAGE STUDIO BRANCHES (warehouse_locations) */}
      {isManageWarehousesOpen && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(30, 20, 60, 0.45)',
            backdropFilter: 'blur(6px)',
            display: 'grid',
            placeItems: 'center',
            zIndex: 1000,
            padding: 18,
          }}
        >
          <div
            style={{
              background: '#ffffff',
              borderRadius: 28,
              padding: 28,
              maxWidth: 640,
              width: '100%',
              maxHeight: '88vh',
              overflowY: 'auto',
              boxShadow: '0 25px 70px rgba(0,0,0,0.22)',
            }}
          >
            <h2 style={{ fontSize: 20, fontWeight: 800, margin: '0 0 12px', color: '#111827' }}>
              Studio Branches &amp; Warehouses ({warehousesList.length})
            </h2>
            <div className="table-responsive" style={{ marginBottom: 16 }}>
              <table className="finset-table">
                <thead>
                  <tr>
                    <th>CODE</th>
                    <th>BRANCH NAME</th>
                    <th>CITY</th>
                    <th>CAPACITY</th>
                    <th>ACTION</th>
                  </tr>
                </thead>
                <tbody>
                  {warehousesList.map((w) => (
                    <tr key={w.id}>
                      <td>
                        <code>{w.branch_code}</code>
                      </td>
                      <td>
                        <strong>{w.branch_name}</strong>
                      </td>
                      <td>{w.city}</td>
                      <td>{w.max_storage_capacity}</td>
                      <td>
                        <button
                          type="button"
                          className="delete-action-btn"
                          style={{ padding: '4px 10px', fontSize: 11 }}
                          onClick={() => handleDeleteWarehouse(w.id, w.branch_name)}
                        >
                          Delete
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <form onSubmit={handleCreateWarehouseSubmit} className="auth-form-finset">
              <div className="form-row">
                <div className="form-group">
                  <label>Branch Code</label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. MNL-BGC"
                    value={whCode}
                    onChange={(e) => setWhCode(e.target.value)}
                  />
                </div>
                <div className="form-group">
                  <label>Branch Name</label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. BGC Studio Hub"
                    value={whName}
                    onChange={(e) => setWhName(e.target.value)}
                  />
                </div>
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label>Address</label>
                  <input
                    type="text"
                    required
                    placeholder="26th St, Bonifacio Global City"
                    value={whAddress}
                    onChange={(e) => setWhAddress(e.target.value)}
                  />
                </div>
                <div className="form-group">
                  <label>City</label>
                  <input
                    type="text"
                    required
                    value={whCity}
                    onChange={(e) => setWhCity(e.target.value)}
                  />
                </div>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 12 }}>
                <button
                  type="button"
                  className="outline-pill-btn"
                  onClick={() => setIsManageWarehousesOpen(false)}
                >
                  Close
                </button>
                <button type="submit" className="primary-purple-btn">
                  + Add Branch
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
