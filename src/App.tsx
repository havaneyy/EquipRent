import { useEffect, useMemo, useState } from 'react';
import type {
  Equipment,
  EquipmentBookedRange,
  RentalOrder,
  MaintenanceRecord,
  AuditLog,
  UserRole,
  UserProfile,
  EquipmentCategory,
  WarehouseLocation,
} from './types/database';
import {
  isSupabaseConfigured,
  fetchEquipmentList,
  fetchEquipmentCategories,
  fetchEquipmentBookedRanges,
  fetchWarehouses,
  createEquipment,
  updateEquipmentDetails,
  deleteEquipment,
  updateEquipmentStatus,
  fetchRentalOrders,
  createRentalOrder,
  cancelRentalOrder,
  updateRentalOrderStatus,
  executeRentalDispatch,
  executeEquipmentReturn,
  fetchMaintenanceRecords,
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
  const [bookedRanges, setBookedRanges] = useState<EquipmentBookedRange[]>([]);
  const [maintenance, setMaintenance] = useState<MaintenanceRecord[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);
  const [usersList, setUsersList] = useState<UserProfile[]>([]);

  // Reservation modal states
  const [rentingEquipment, setRentingEquipment] = useState<Equipment | null>(null);
  const [returningItemId, setReturningItemId] = useState<string | null>(null);

  // Booking form state with Name & Contact Number & Future Date validation
  const todayDate = toDateInputValue(new Date());
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
  const [returnOdometer, setReturnOdometer] = useState('');
  const [returnFuel, setReturnFuel] = useState('');
  const [returnCleanliness, setReturnCleanliness] = useState('');
  const [returnIntegrity, setReturnIntegrity] = useState('');
  const [damageNotes, setDamageNotes] = useState<string>('');
  const [penaltyFee, setPenaltyFee] = useState('');
  const [returnPhysicallyReceived, setReturnPhysicallyReceived] = useState(false);

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
  const [adminBorrowedTab, setAdminBorrowedTab] = useState<'borrowed' | 'returned'>('borrowed');
  const [userSearch, setUserSearch] = useState('');

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
      const [eq, cats, whs, ord, ranges, maint, logs, users] = await Promise.all([
        fetchEquipmentList(),
        fetchEquipmentCategories().catch(() => []),
        currentRole === 'admin' ? fetchWarehouses().catch(() => []) : Promise.resolve([]),
        fetchRentalOrders(currentRole === 'customer' ? currentUser.id : undefined),
        fetchEquipmentBookedRanges().catch(() => []),
        currentRole === 'customer' ? Promise.resolve([]) : fetchMaintenanceRecords(),
        currentRole === 'admin' ? fetchAuditLogs().catch(() => []) : Promise.resolve([]),
        currentRole === 'admin' ? fetchUserProfiles().catch(() => []) : Promise.resolve([]),
      ]);
      setEquipmentList(eq);
      setCategoriesList(cats);
      setWarehousesList(whs);
      if (eq.length > 0 && !calEquipId) {
        setCalEquipId(eq[0].id);
      }
      setOrders(ord);
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
    if (currentUser) {
      reloadData();
    }
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
              deliveryAddress: ord.delivery_address || 'Depot',
              status: item.item_status,
            });
          }
        });
      }
    });
    return list;
  }, [orders]);

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
      return [
        { label: 'Dashboard' },
        { label: 'Fleet Inventory' },
        {
          label: 'Orders & Requests',
          badge: pendingReviewCount ? String(pendingReviewCount) : undefined,
        },
        { label: 'Dispatch & Checkout' },
        { label: 'Return & Inspection' },
        {
          label: 'Maintenance Queue',
          badge: maintenance.length ? String(maintenance.length) : undefined,
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
      { label: 'Maintenance Oversight' },
      { label: 'Engine Audit Logs', badge: auditLogs.length ? String(auditLogs.length) : undefined },
      { label: 'My Profile' },
    ];
  }, [currentRole, orders, maintenance.length, auditLogs.length]);

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

  // 1. Customer Booking Submit with Future Date & Double-Booking Overlap Validation
  const handleBookingSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!rentingEquipment || !currentUser) return;
    try {
      if (!bookCustomerName.trim()) {
        throw new Error('Please enter your full name for the reservation confirmation.');
      }
      if (!bookCustomerPhone.trim()) {
        throw new Error('Please enter your contact phone number.');
      }
      const parsedDays = Number(bookDays);
      if (bookDays === '' || !Number.isInteger(parsedDays) || parsedDays < 1 || parsedDays > 30) {
        throw new Error('Rental duration must be between 1 and 30 days.');
      }
      if (!bookAddress.trim()) {
        throw new Error('Enter the job site or delivery address.');
      }
      // Strict Date Validation: Only today or future dates! Cannot book yesterday!
      if (bookStartDate < todayDate) {
        throw new Error(
          'Rental start date cannot be in the past (yesterday or earlier). Please choose today or a future date.'
        );
      }
      const start = new Date(`${bookStartDate}T00:00:00`);
      if (Number.isNaN(start.getTime())) {
        throw new Error('Choose a valid rental start date.');
      }
      const startDateStr = toDateInputValue(start);
      const endDateStr = addDaysToDateStr(startDateStr, parsedDays - 1);

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
        customerId: currentUser.id,
        equipmentId: rentingEquipment.id,
        unitDailyRate: rentingEquipment.daily_rental_rate,
        dailyInsuranceRate,
        days: parsedDays,
        startDate: startDateStr,
        endDate: endDateStr,
        deliveryAddress: bookAddress,
        customerName: bookCustomerName,
        customerPhone: formatPhilippinePhone(bookCustomerPhone),
      });

      showToast(`Reservation submitted for ${rentingEquipment.model_name}! Status is Pending.`);
      setRentingEquipment(null);
      await reloadData();
      setActiveTab('My Reservations');
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

  // 5. Staff Dispatches Equipment (Validation: Cannot dispatch past/expired orders)
  const handleDispatchCheckout = async (orderId: string) => {
    if (!currentUser) return;
    try {
      const targetOrder = orders.find((o) => o.id === orderId);
      if (targetOrder && targetOrder.expected_end_date < todayDate) {
        throw new Error('Cannot dispatch this order: the rental end date has already passed.');
      }
      await executeRentalDispatch(orderId, currentUser.id);
      showToast('Equipment successfully dispatched to customer.');
      await reloadData();
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Dispatch failed');
    }
  };

  // 6. Staff Return Inspection (Validation: Staff can ONLY press return if equipment has physically returned)
  const handleReturnSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!returningItemId || !currentUser) return;
    try {
      if (!returnPhysicallyReceived) {
        throw new Error(
          'Verification Required: You can only complete return after confirming the equipment has been physically received at the depot.'
        );
      }
      if (
        returnOdometer === '' ||
        returnFuel === '' ||
        returnCleanliness === '' ||
        returnIntegrity === ''
      ) {
        throw new Error(
          'Enter the observed odometer, fuel level, cleanliness, and integrity before submitting.'
        );
      }
      const parsedOdometer = Number(returnOdometer);
      const parsedFuel = Number(returnFuel);
      const parsedCleanliness = Number(returnCleanliness);
      const parsedIntegrity = Number(returnIntegrity);
      const parsedPenaltyFee = penaltyFee === '' ? 0 : Number(penaltyFee);
      if (
        !Number.isFinite(parsedOdometer) ||
        parsedOdometer < 0 ||
        !Number.isInteger(parsedFuel) ||
        parsedFuel < 0 ||
        parsedFuel > 100 ||
        !Number.isInteger(parsedCleanliness) ||
        parsedCleanliness < 1 ||
        parsedCleanliness > 5 ||
        !Number.isInteger(parsedIntegrity) ||
        parsedIntegrity < 1 ||
        parsedIntegrity > 5 ||
        !Number.isFinite(parsedPenaltyFee) ||
        parsedPenaltyFee < 0
      ) {
        throw new Error('Enter valid inspection values within the displayed ranges.');
      }
      const res = await executeEquipmentReturn({
        orderItemId: returningItemId,
        returnOdometer: parsedOdometer,
        fuelLevel: parsedFuel,
        cleanliness: parsedCleanliness,
        integrity: parsedIntegrity,
        inspectorId: currentUser.id,
        damageNotes: damageNotes || undefined,
        penaltyFee: parsedPenaltyFee,
      });
      showToast(
        res.maintenanceCreated
          ? 'Damage noted. Maintenance work order created.'
          : 'Return completed.'
      );
      setReturningItemId(null);
      setReturnOdometer('');
      setReturnFuel('');
      setReturnCleanliness('');
      setReturnIntegrity('');
      setDamageNotes('');
      setPenaltyFee('');
      setReturnPhysicallyReceived(false);
      await reloadData();
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Return inspection failed');
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
  const bookingEndDate =
    bookStartDate && bookingDays >= 1 ? addDaysToDateStr(bookStartDate, bookingDays - 1) : '';
  const bookingOverlapReason =
    rentingEquipment && bookStartDate
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
                  ? 'Heavy equipment fleet catalog & reservation hub'
                  : currentRole === 'staff'
                    ? 'Fleet operations, dispatch, returns & order reviews'
                    : 'System oversight, asset management & user control'}
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
                              <span className="confirmed-status-badge">Returned {r.returnDate}</span>
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
                            onClick={() => {
                              setRentingEquipment(item);
                              setBookStartDate(findNextAvailableDate(item.id));
                              setBookCustomerName(currentUser.full_name);
                              setBookCustomerPhone(currentUser.phone);
                            }}
                          >
                            Reserve
                          </button>
                        ) : (
                          <span className="confirmed-status-badge">Ready</span>
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
                    <button
                      className="primary-purple-btn"
                      onClick={() => setIsAddEquipmentOpen(true)}
                      style={{ padding: '8px 16px', fontSize: 12 }}
                    >
                      + Add Equipment
                    </button>
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
                              onClick={() => {
                                setRentingEquipment(item);
                                setBookStartDate(findNextAvailableDate(item.id));
                                setBookCustomerName(currentUser.full_name);
                                setBookCustomerPhone(currentUser.phone);
                              }}
                              style={{ opacity: item.current_status === 'available' ? 1 : 0.4 }}
                            >
                              Reserve
                            </button>
                          )}

                          {currentRole === 'staff' && (
                            <button
                              className="reserve-purple-btn"
                              onClick={async () => {
                                try {
                                  await updateEquipmentStatus(
                                    item.id,
                                    item.current_status === 'available' ? 'under_maintenance' : 'available'
                                  );
                                  showToast('Equipment status updated.');
                                  await reloadData();
                                } catch (error: unknown) {
                                  showToast(
                                    error instanceof Error ? error.message : 'Could not update status.'
                                  );
                                }
                              }}
                            >
                              Toggle State
                            </button>
                          )}

                          {currentRole === 'admin' && (
                            <div className="crud-btn-group">
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

                  {currentRole === 'customer' ? (
                    <button
                      className="primary-purple-btn"
                      disabled={selectedDateBlocked}
                      style={{ opacity: selectedDateBlocked ? 0.5 : 1, cursor: selectedDateBlocked ? 'not-allowed' : 'pointer' }}
                      onClick={() => {
                        setRentingEquipment(selectedCalEquip);
                        setBookStartDate(calSelectedDate);
                        setBookCustomerName(currentUser.full_name);
                        setBookCustomerPhone(currentUser.phone);
                      }}
                    >
                      {selectedDateBlockReason
                        ? `Unavailable on ${calSelectedDate}`
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
                      const equipName = o.items?.[0]?.equipment?.model_name || 'Equipment';
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
                              <span className="completed-status-badge">Completed</span>
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
                      const equipName = ord.items?.[0]?.equipment?.model_name || 'Equipment';
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
                          <td>{equipName}</td>
                          <td>
                            {ord.expected_start_date} &rarr; {ord.expected_end_date}
                          </td>
                          <td style={{ fontWeight: 800, color: 'var(--purple-main)' }}>
                            {formatPHP(totalDue)}
                          </td>
                          <td>
                            {ord.status === 'draft' ? (
                              <span className="pending-status-badge">⏳ Pending Review</span>
                            ) : ord.status === 'confirmed' ? (
                              <span className="confirmed-status-badge">✓ Confirmed</span>
                            ) : ord.status === 'in_progress' ? (
                              <span className="in-progress-status-badge">🚚 Dispatched</span>
                            ) : ord.status === 'completed' ? (
                              <span className="completed-status-badge">Completed</span>
                            ) : (
                              <span className="cancelled-status-badge">Cancelled</span>
                            )}
                          </td>
                          <td>
                            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
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
                                <button
                                  className="primary-purple-btn"
                                  style={{ padding: '5px 12px', fontSize: 11 }}
                                  onClick={() => handleDispatchCheckout(ord.id)}
                                  title="Dispatch to customer"
                                >
                                  Dispatch &rarr;
                                </button>
                              ) : ord.status === 'in_progress' ? (
                                <span style={{ fontSize: 11, color: '#1d4ed8', fontWeight: 600 }}>
                                  Active on Site
                                </span>
                              ) : (
                                <span style={{ fontSize: 11, color: '#9ca3af' }}>Archived</span>
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
                  <h3 className="chart-card-title">Dispatch Operations</h3>
                </div>
              </div>

              <div className="table-responsive">
                <table className="finset-table">
                  <thead>
                    <tr>
                      <th>ORDER NUMBER</th>
                      <th>CUSTOMER</th>
                      <th>RENTAL DATES</th>
                      <th>STATUS</th>
                      <th>ACTION</th>
                    </tr>
                  </thead>
                  <tbody>
                    {orders
                      .filter((ord) => ord.status === 'confirmed' || ord.status === 'in_progress')
                      .map((ord) => (
                        <tr key={ord.id}>
                          <td>
                            <strong>{ord.order_number}</strong>
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
                            {ord.expected_start_date} &rarr; {ord.expected_end_date}
                          </td>
                          <td>
                            {ord.status === 'confirmed' ? (
                              <span className="confirmed-status-badge">Ready for Dispatch</span>
                            ) : (
                              <span className="in-progress-status-badge">Dispatched</span>
                            )}
                          </td>
                          <td>
                            {ord.status === 'confirmed' ? (
                              <button
                                className="primary-purple-btn"
                                style={{ padding: '6px 14px', fontSize: 11 }}
                                onClick={() => handleDispatchCheckout(ord.id)}
                              >
                                Complete Dispatch
                              </button>
                            ) : (
                              <span style={{ color: '#047857', fontSize: 11, fontWeight: 600 }}>
                                Dispatched
                              </span>
                            )}
                          </td>
                        </tr>
                      ))}
                    {orders.filter((ord) => ord.status === 'confirmed' || ord.status === 'in_progress').length ===
                      0 && (
                      <tr>
                        <td colSpan={5} style={{ textAlign: 'center', padding: 30, color: 'var(--text-muted)' }}>
                          No orders currently awaiting dispatch.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* TAB 7: RETURN & INSPECTION (STAFF CAN ONLY PRESS RETURN IF EQUIPMENT HAS RETURNED) */}
          {currentRole === 'staff' && activeTab === 'Return & Inspection' && (
            <div className="transactions-table-card" style={{ marginTop: 6 }}>
              <div className="table-card-header">
                <div>
                  <h3 className="chart-card-title">Equipment Returns & Depot Inspection</h3>
                </div>
              </div>

              <div className="table-responsive">
                <table className="finset-table">
                  <thead>
                    <tr>
                      <th>ITEM ID</th>
                      <th>MACHINERY MODEL</th>
                      <th>STATUS</th>
                      <th>DISPATCH HOURS</th>
                      <th>RETURN ACTION</th>
                    </tr>
                  </thead>
                  <tbody>
                    {orders
                      .flatMap((o) => o.items || [])
                      .map((item) => (
                        <tr key={item.id}>
                          <td>
                            <code>{item.id.slice(0, 8)}</code>
                          </td>
                          <td>
                            <strong>{item.equipment?.model_name || '—'}</strong>
                          </td>
                          <td>
                            {item.item_status === 'dispatched' ? (
                              <span className="in-progress-status-badge">Currently on Rent</span>
                            ) : item.item_status === 'returned' ? (
                              <span className="confirmed-status-badge">Returned to Depot</span>
                            ) : item.item_status === 'damaged' ? (
                              <span className="cancelled-status-badge">Returned Damaged</span>
                            ) : (
                              <span className="pending-status-badge">{item.item_status}</span>
                            )}
                          </td>
                          <td>
                            {item.dispatch_odometer_hours ?? '—'}
                            {item.dispatch_odometer_hours == null ? '' : ' hrs'}
                          </td>
                          <td>
                            {item.item_status === 'dispatched' ? (
                              <button
                                className="primary-purple-btn"
                                style={{ padding: '6px 14px', fontSize: 11 }}
                                onClick={() => {
                                  setReturningItemId(item.id);
                                  setReturnOdometer('');
                                  setReturnFuel('');
                                  setReturnCleanliness('');
                                  setReturnIntegrity('');
                                  setDamageNotes('');
                                  setPenaltyFee('');
                                  setReturnPhysicallyReceived(false);
                                }}
                              >
                                Process Return & Inspection
                              </button>
                            ) : (
                              <span style={{ color: '#047857', fontSize: 11, fontWeight: 600 }}>
                                Inspected & Checked In
                              </span>
                            )}
                          </td>
                        </tr>
                      ))}
                    {orders.flatMap((o) => o.items || []).length === 0 && (
                      <tr>
                        <td colSpan={5} style={{ textAlign: 'center', padding: 30, color: 'var(--text-muted)' }}>
                          No equipment currently awaiting return.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* TAB 8: ADMIN BORROWED & RETURNED ITEMS TRACKING */}
          {currentRole === 'admin' && activeTab === 'Borrowed & Returned Items' && (
            <div className="transactions-table-card" style={{ marginTop: 6 }}>
              <div className="table-card-header">
                <div>
                  <h3 className="chart-card-title">Borrowed & Returned Equipment Tracking</h3>
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
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
                </div>
              </div>

              {adminBorrowedTab === 'borrowed' ? (
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
                        <th>EQUIPMENT</th>
                        <th>SERIAL #</th>
                        <th>CUSTOMER</th>
                        <th>RETURN DATE</th>
                        <th>RETURN HOURS</th>
                        <th>INSPECTION STATUS</th>
                      </tr>
                    </thead>
                    <tbody>
                      {returnedItems.map((r) => (
                        <tr key={r.itemId}>
                          <td>
                            <strong>{r.equipmentName}</strong>
                          </td>
                          <td>
                            <code>{r.serialNumber}</code>
                          </td>
                          <td>{r.customerName}</td>
                          <td>{r.returnDate}</td>
                          <td>{r.hours ? `${r.hours} hrs` : 'Logged'}</td>
                          <td>
                            {r.status === 'damaged' ? (
                              <span className="cancelled-status-badge">Damage Logged</span>
                            ) : (
                              <span className="confirmed-status-badge">Checked In Clean</span>
                            )}
                          </td>
                        </tr>
                      ))}
                      {returnedItems.length === 0 && (
                        <tr>
                          <td colSpan={6} style={{ textAlign: 'center', padding: 30, color: 'var(--text-muted)' }}>
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
                  <h3 className="chart-card-title">Maintenance Records</h3>
                </div>
              </div>

              <div className="table-responsive">
                <table className="finset-table">
                  <thead>
                    <tr>
                      <th>WORK ORDER</th>
                      <th>EQUIPMENT</th>
                      <th>TYPE</th>
                      <th>ODOMETER</th>
                      <th>COST</th>
                      <th>STATUS</th>
                    </tr>
                  </thead>
                  <tbody>
                    {maintenance.map((m) => (
                      <tr key={m.id}>
                        <td>
                          <strong>{m.work_order_number}</strong>
                        </td>
                        <td>{m.equipment?.model_name || 'Equipment'}</td>
                        <td>{m.maintenance_type}</td>
                        <td>{m.odometer_hours_at_service} hrs</td>
                        <td style={{ fontWeight: 800 }}>{formatPHP(m.total_maintenance_cost)}</td>
                        <td>
                          <span className="pending-status-badge">{m.maintenance_status}</span>
                        </td>
                      </tr>
                    ))}
                    {maintenance.length === 0 && (
                      <tr>
                        <td colSpan={6} style={{ textAlign: 'center', padding: 30, color: 'var(--text-muted)' }}>
                          No active maintenance work orders.
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
                      <label>Company / Depot</label>
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
              Confirm Reservation: {rentingEquipment.model_name}
            </h2>
            <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '0 0 18px' }}>
              {formatPHP(rentingEquipment.daily_rental_rate)}/day &bull; Value: {formatPHP(rentingEquipment.replacement_value)}
            </p>

            <form onSubmit={handleBookingSubmit} className="auth-form-finset">
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
                    onChange={(e) => setBookStartDate(e.target.value)}
                    required
                  />
                  <small style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                    Today or future dates only
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
                <label>Job Site / Delivery Address</label>
                <input
                  type="text"
                  placeholder="e.g. Warehouse 4, Subic Port"
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
                {bookingOverlapReason ? (
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
                  disabled={Boolean(bookingOverlapReason)}
                  style={{
                    opacity: bookingOverlapReason ? 0.5 : 1,
                    cursor: bookingOverlapReason ? 'not-allowed' : 'pointer',
                  }}
                >
                  Confirm Reservation Request
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 2: RETURN INSPECTION (STAFF MUST CONFIRM PHYSICAL RETURN) */}
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
              maxWidth: 500,
              width: '100%',
              boxShadow: '0 25px 70px rgba(0,0,0,0.22)',
            }}
          >
            <h2 style={{ fontSize: 22, fontWeight: 800, margin: '0 0 6px', color: '#111827' }}>
              Return Inspection
            </h2>
            <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '0 0 16px' }}>
              Staff return check-in protocol and physical asset verification.
            </p>

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
                  <span>I confirm this equipment has been physically returned and received at the depot.</span>
                </label>
              </div>

              <div className="form-group">
                <label>Observed Return Odometer Hours</label>
                <input
                  type="number"
                  step="0.5"
                  min="0"
                  placeholder="e.g. 142.5"
                  value={returnOdometer}
                  onChange={(e) => setReturnOdometer(e.target.value)}
                  required
                />
              </div>

              <div className="form-row">
                <div className="form-group">
                  <label>Fuel Level (%)</label>
                  <input
                    type="number"
                    min="0"
                    max="100"
                    placeholder="100"
                    value={returnFuel}
                    onChange={(e) => setReturnFuel(e.target.value)}
                    required
                  />
                </div>
                <div className="form-group">
                  <label>Cleanliness (1-5)</label>
                  <input
                    type="number"
                    min="1"
                    max="5"
                    placeholder="5"
                    value={returnCleanliness}
                    onChange={(e) => setReturnCleanliness(e.target.value)}
                    required
                  />
                </div>
              </div>

              <div className="form-group">
                <label>Integrity Rating (1-5)</label>
                <input
                  type="number"
                  min="1"
                  max="5"
                  placeholder="5"
                  value={returnIntegrity}
                  onChange={(e) => setReturnIntegrity(e.target.value)}
                  required
                />
              </div>

              <div className="form-group">
                <label>Condition / Damage Notes (Optional)</label>
                <textarea
                  rows={2}
                  placeholder="Note any visible wear, dents, or required maintenance..."
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

              <div className="form-group">
                <label>Penalty Fee (PHP, Optional)</label>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  placeholder="0.00"
                  value={penaltyFee}
                  onChange={(e) => setPenaltyFee(e.target.value)}
                />
              </div>

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
                  style={{ opacity: returnPhysicallyReceived ? 1 : 0.5 }}
                >
                  Complete Return & Inspection
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
              Add New Machinery to Fleet
            </h2>
            <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '0 0 18px' }}>
              Admin equipment catalog provisioning.
            </p>

            <form onSubmit={handleCreateEquipment} className="auth-form-finset">
              <div className="form-row">
                <div className="form-group">
                  <label>Model Name</label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. CAT 320D Excavator"
                    value={eqModelName}
                    onChange={(e) => setEqModelName(e.target.value)}
                  />
                </div>
                <div className="form-group">
                  <label>Manufacturer</label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. Caterpillar"
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
                    placeholder="e.g. CAT-320D-9982"
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
                    placeholder="e.g. 5000"
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
                    placeholder="e.g. 2500000"
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
                  <label>Depot / Warehouse</label>
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
    </div>
  );
}
