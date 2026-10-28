export type UserRole = 'admin' | 'staff' | 'customer';
export type EquipmentStatus = 'available' | 'rented' | 'under_maintenance' | 'decommissioned';
export type RentalOrderStatus = 'draft' | 'confirmed' | 'in_progress' | 'completed' | 'cancelled';
export type ItemRentalStatus = 'reserved' | 'dispatched' | 'returned' | 'damaged';
export type PaymentStatus = 'unpaid' | 'partially_paid' | 'paid' | 'refunded';
export type MaintenanceType = 'scheduled_routine' | 'emergency_repair' | 'post_rental_inspection' | 'major_overhaul';
export type MaintenanceStatus = 'pending' | 'in_progress' | 'completed' | 'cancelled';

export interface UserProfile {
  id: string;
  auth_user_id?: string | null;
  full_name: string;
  email: string;
  phone: string;
  company_name?: string | null;
  role: UserRole;
  requested_role?: UserRole | null;
  account_status: 'active' | 'suspended' | 'pending';
  created_at: string;
  updated_at: string;
}

export interface WarehouseLocation {
  id: string;
  branch_code: string;
  branch_name: string;
  address: string;
  city: string;
  region: string;
  contact_phone: string;
  manager_id?: string | null;
  max_storage_capacity: number;
  created_at: string;
}

export interface EquipmentCategory {
  id: string;
  category_name: string;
  category_code: string;
  description?: string | null;
  base_daily_insurance_rate: number;
  requires_operator_certification: boolean;
  created_at: string;
}

export interface Equipment {
  id: string;
  serial_number: string;
  model_name: string;
  manufacturer: string;
  model_year: number;
  category_id: string;
  warehouse_id: string;
  daily_rental_rate: number;
  replacement_value: number;
  operational_hours: number;
  current_status: EquipmentStatus;
  image_url?: string | null;
  maintenance_interval_hours: number;
  created_at: string;
  updated_at: string;
  // Joined fields
  category?: EquipmentCategory;
  warehouse?: WarehouseLocation;
}

export interface RentalOrder {
  id: string;
  order_number: string;
  customer_id: string;
  authorized_staff_id?: string | null;
  status: RentalOrderStatus;
  order_date: string;
  expected_start_date: string;
  expected_end_date: string;
  actual_return_date?: string | null;
  subtotal_amount: number;
  insurance_amount: number;
  tax_amount: number;
  security_deposit_amount: number;
  total_amount: number;
  payment_status: PaymentStatus;
  delivery_address?: string | null;
  special_terms?: string | null;
  created_at: string;
  updated_at: string;
  // Joined fields
  customer?: UserProfile;
  authorized_staff?: UserProfile;
  items?: RentalOrderItem[];
}

export interface RentalOrderItem {
  id: string;
  rental_order_id: string;
  equipment_id: string;
  unit_daily_rate: number;
  days_rented: number;
  daily_insurance_rate: number;
  item_subtotal: number;
  item_status: ItemRentalStatus;
  dispatch_odometer_hours?: number | null;
  return_odometer_hours?: number | null;
  dispatched_at?: string | null;
  returned_at?: string | null;
  condition_notes?: string | null;
  created_at: string;
  // Joined equipment
  equipment?: Equipment;
}

export interface MaintenanceRecord {
  id: string;
  work_order_number: string;
  equipment_id: string;
  maintenance_type: MaintenanceType;
  maintenance_status: MaintenanceStatus;
  scheduled_date: string;
  completed_date?: string | null;
  odometer_hours_at_service: number;
  parts_cost: number;
  labor_cost: number;
  total_maintenance_cost: number;
  lead_technician_id?: string | null;
  service_description: string;
  created_at: string;
  updated_at: string;
  // Joined
  equipment?: Equipment;
  lead_technician?: UserProfile;
  tasks?: MaintenanceTask[];
}

export interface MaintenanceTask {
  id: string;
  maintenance_id: string;
  technician_id: string;
  task_code: string;
  task_name: string;
  hours_logged: number;
  hourly_labor_rate: number;
  task_cost: number;
  progress_status: 'assigned' | 'in_progress' | 'completed' | 'blocked';
  findings_report?: string | null;
  sign_off_timestamp?: string | null;
  created_at: string;
  technician?: UserProfile;
}

export interface EquipmentInspection {
  id: string;
  rental_order_item_id: string;
  inspector_id: string;
  inspection_type: 'pre_dispatch' | 'post_return';
  fuel_level_percent: number;
  odometer_reading: number;
  cleanliness_rating: number;
  structural_integrity_rating: number;
  damage_identified: boolean;
  damage_assessment_notes?: string | null;
  penalty_fee: number;
  sign_off_status: boolean;
  created_at: string;
  inspector?: UserProfile;
}

export interface AuditLog {
  id: string;
  table_name: string;
  record_id: string;
  action_type: 'INSERT' | 'UPDATE' | 'DELETE';
  old_data?: Record<string, unknown> | null;
  new_data?: Record<string, unknown> | null;
  changed_fields?: string[] | null;
  performed_by?: string | null;
  client_ip?: string | null;
  executed_at: string;
}

export interface FleetUtilizationAnalytics {
  category_name: string;
  total_units: number;
  available_units: number;
  rented_units: number;
  maintenance_units: number;
  utilization_percentage: number;
  total_revenue_generated: number;
}
