import React, { useState, useEffect, useMemo } from 'react';
import API from '../services/api';
import { 
  Wrench, 
  Layers, 
  Users, 
  ShoppingCart, 
  Activity, 
  ClipboardList, 
  PlusCircle,
  RefreshCcw,
  Pencil,
  Trash2,
  X,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Ban,
  Search,
  Filter,
  Calendar,
  Tag,
  ShieldCheck,
  Check,
  ArrowRight
} from 'lucide-react';

export default function Dashboard({ user: initialUser, onLogout }) {
  // Navigation & View Mode
  const [activeTab, setActiveTab] = useState('operations'); // 'operations' (unified), 'maintenance', 'audit', 'users'
  const [operationsView, setOperationsView] = useState('combined'); // 'combined' (unified table) | 'ledger' (contract history)
  
  // Data State
  const [equipment, setEquipment] = useState([]);
  const [categories, setCategories] = useState([]);
  const [rentals, setRentals] = useState([]);
  const [maintenance, setMaintenance] = useState([]);
  const [auditLogs, setAuditLogs] = useState([]);
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);

  // Search & Filtering State
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('All');
  const [selectedCategory, setSelectedCategory] = useState('All');

  // Real logged-in user context
  const [currentUser, setCurrentUser] = useState(initialUser || { user_id: 1, role_id: 4, customer_id: 1 });

  // Modal & Form States
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingItem, setEditingItem] = useState(null);
  const [formData, setFormData] = useState({
    equipment_name: '',
    category_id: '',
    rental_price: '',
    equipment_status: 'Available',
    condition_status: 'Good'
  });

  // Action Target States
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [returnTarget, setReturnTarget] = useState(null);
  const [activateTarget, setActivateTarget] = useState(null);
  const [cancelTarget, setCancelTarget] = useState(null);
  const [activationDays, setActivationDays] = useState(3);
  const [userDeleteTarget, setUserDeleteTarget] = useState(null);
  const [maintenanceCompleteTarget, setMaintenanceCompleteTarget] = useState(null);
  const [errorMessage, setErrorMessage] = useState(null);
  const [feedbackNotice, setFeedbackNotice] = useState(null);

  // Sync initialUser if updated
  useEffect(() => {
    if (initialUser) {
      setCurrentUser(prev => ({
        ...prev,
        ...initialUser,
        user_id: initialUser.id || initialUser.user_id || prev.user_id,
        customer_id: initialUser.customer_id || initialUser.id || initialUser.user_id || prev.customer_id,
      }));
    }
  }, [initialUser]);

  // Fetch current user profile and all dashboard data on mount
  const fetchData = async () => {
    setLoading(true);
    try {
      const token = localStorage.getItem('token');
      if (token) {
        try {
          const userRes = await API.get('/auth/me');
          if (userRes) {
            setCurrentUser(prev => ({
              ...prev,
              user_id: userRes.user_id,
              role_id: userRes.role_id,
              customer_id: userRes.customer_id || userRes.user_id,
              email: userRes.email,
              first_name: userRes.first_name,
              last_name: userRes.last_name,
              role: userRes.role
            }));
          }
        } catch (authErr) {
          console.error('Failed to load user profile:', authErr);
        }
      }

      const results = await Promise.allSettled([
        API.get('/equipment'),
        API.get('/equipment/categories'),
        API.get('/rentals'),
        API.get('/maintenance'),
        API.get('/audit-logs'),
        API.get('/users'),
      ]);

      const eqRes = results[0].status === 'fulfilled' ? results[0].value : [];
      const catRes = results[1].status === 'fulfilled' ? results[1].value : [];
      const rentRes = results[2].status === 'fulfilled' ? results[2].value : [];
      const maintRes = results[3].status === 'fulfilled' ? results[3].value : [];
      const auditRes = results[4].status === 'fulfilled' ? results[4].value : [];
      const userRes = results[5].status === 'fulfilled' ? results[5].value : [];

      const sortedEquipment = (eqRes || []).sort((a, b) => 
        (a.equipment_name || '').localeCompare(b.equipment_name || '')
      );

      setEquipment(sortedEquipment);
      setCategories(catRes || []);
      setRentals(rentRes || []);
      setMaintenance(maintRes || []);
      setAuditLogs(auditRes || []);
      setUsers(userRes || []);
    } catch (err) {
      console.error('Failed to fetch dashboard data:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  // Auto-dismiss feedback notice
  useEffect(() => {
    if (feedbackNotice) {
      const timer = setTimeout(() => setFeedbackNotice(null), 4000);
      return () => clearTimeout(timer);
    }
  }, [feedbackNotice]);

  // Helper functions to correlate equipment with active rentals & maintenance
  const findActiveRental = (equipmentId) => {
    return rentals.find(r => 
      (r.rental_status === 'Reserved' || r.rental_status === 'Active') &&
      r.rental_items?.some(ri => ri.equipment_id === equipmentId)
    );
  };

  const findActiveMaintenance = (equipmentId) => {
    return maintenance.find(m => 
      m.equipment_id === equipmentId && m.maintenance_status !== 'Completed'
    );
  };

  const isUserRental = (rental) => {
    if (!rental) return false;
    const uid = currentUser?.user_id;
    const cid = currentUser?.customer_id;
    return (
      (uid && (rental.customer?.user_id === uid || rental.customer?.user?.user_id === uid)) ||
      (cid && (rental.customer_id === cid || rental.customer?.customer_id === cid))
    );
  };

  // Inventory & Rental Statistics
  const stats = useMemo(() => {
    const total = equipment.length;
    const available = equipment.filter(e => e.equipment_status === 'Available').length;
    const reserved = equipment.filter(e => e.equipment_status === 'Reserved').length;
    const rented = equipment.filter(e => e.equipment_status === 'Rented').length;
    const underMaintenance = equipment.filter(e => e.equipment_status === 'Under Maintenance').length;
    const myItems = equipment.filter(e => {
      const r = findActiveRental(e.equipment_id);
      return isUserRental(r);
    }).length;

    return { total, available, reserved, rented, underMaintenance, myItems };
  }, [equipment, rentals, currentUser]);

  // Filtered Equipment for Unified Table
  const filteredEquipment = useMemo(() => {
    return equipment.filter(item => {
      const activeRental = findActiveRental(item.equipment_id);
      const isMine = isUserRental(activeRental);

      // Search Query
      const q = searchQuery.toLowerCase().trim();
      const matchesSearch = !q || 
        item.equipment_name.toLowerCase().includes(q) ||
        (item.category?.category_name || '').toLowerCase().includes(q) ||
        (item.description || '').toLowerCase().includes(q) ||
        `#${item.equipment_id}`.includes(q) ||
        (activeRental?.customer?.user && 
          `${activeRental.customer.user.first_name} ${activeRental.customer.user.last_name}`.toLowerCase().includes(q));

      // Category Filter
      const matchesCategory = selectedCategory === 'All' || String(item.category_id) === String(selectedCategory);

      // Status Filter
      let matchesStatus = true;
      if (statusFilter === 'Available') {
        matchesStatus = item.equipment_status === 'Available';
      } else if (statusFilter === 'Reserved') {
        matchesStatus = item.equipment_status === 'Reserved';
      } else if (statusFilter === 'Rented') {
        matchesStatus = item.equipment_status === 'Rented';
      } else if (statusFilter === 'Under Maintenance') {
        matchesStatus = item.equipment_status === 'Under Maintenance';
      } else if (statusFilter === 'My Items') {
        matchesStatus = isMine;
      }

      return matchesSearch && matchesCategory && matchesStatus;
    });
  }, [equipment, rentals, searchQuery, selectedCategory, statusFilter, currentUser]);

  // Modal Handlers
  const handleOpenCreateModal = () => {
    setEditingItem(null);
    setFormData({
      equipment_name: '',
      category_id: categories[0]?.category_id || '',
      rental_price: '',
      equipment_status: 'Available',
      condition_status: 'Good'
    });
    setIsModalOpen(true);
  };

  const handleOpenEditModal = (item) => {
    setEditingItem(item);
    setFormData({
      equipment_name: item.equipment_name,
      category_id: item.category_id,
      rental_price: item.rental_price,
      equipment_status: item.equipment_status,
      condition_status: item.condition_status
    });
    setIsModalOpen(true);
  };

  const handleCloseModal = () => {
    setIsModalOpen(false);
    setEditingItem(null);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      const payload = {
        ...formData,
        category_id: parseInt(formData.category_id, 10),
        rental_price: parseFloat(formData.rental_price)
      };

      if (editingItem) {
        await API.put(`/equipment/${editingItem.equipment_id}`, payload);
        setFeedbackNotice(`Successfully updated equipment: ${formData.equipment_name}`);
      } else {
        await API.post('/equipment', payload);
        setFeedbackNotice(`Successfully created new equipment: ${formData.equipment_name}`);
      }

      handleCloseModal();
      fetchData();
    } catch (err) {
      setErrorMessage('Failed to save equipment: ' + (err.message || 'Unknown error'));
    }
  };

  // Customer Online Reservation Handler
  const handleReserveItem = async (item) => {
    try {
      const payload = {
        customer_id: currentUser.customer_id || currentUser.user_id || 1,
        total_amount: item.rental_price,
        is_reservation: true,
        equipment_ids: [{
          equipment_id: item.equipment_id,
          rental_price: item.rental_price,
          item_condition: item.condition_status
        }]
      };

      await API.post('/rentals', payload);
      setFeedbackNotice(`Reservation submitted for ${item.equipment_name}! It is now on a 24-hour counter hold.`);
      fetchData();
    } catch (err) {
      setErrorMessage('Failed to reserve equipment: ' + (err.message || 'Unknown error'));
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    try {
      await API.delete(`/equipment/${deleteTarget.equipment_id}`);
      setFeedbackNotice(`Deleted equipment: ${deleteTarget.equipment_name}`);
      setDeleteTarget(null);
      fetchData();
    } catch (err) {
      setDeleteTarget(null);
      setErrorMessage('Failed to delete equipment. Items linked to active rentals or maintenance cannot be deleted.');
    }
  };

  const confirmReturn = async () => {
    if (!returnTarget) return;
    try {
      await API.put(`/rentals/${returnTarget.rental_id}/status`, {
        rental_status: 'Returned',
        actual_return_date: new Date().toISOString()
      });
      setFeedbackNotice(`Rental #${returnTarget.rental_id} marked as Returned. Equipment is now Available!`);
      setReturnTarget(null);
      fetchData();
    } catch (err) {
      setReturnTarget(null);
      setErrorMessage('Failed to return rental: ' + (err.message || 'Unknown error'));
    }
  };

  // Staff Counter Activation Handler
  const confirmActivation = async () => {
    if (!activateTarget) return;
    try {
      await API.put(`/rentals/${activateTarget.rental_id}/status`, {
        rental_status: 'Active',
        staff_id: currentUser.user_id,
        rental_days: parseInt(activationDays)
      });
      setFeedbackNotice(`Reservation #${activateTarget.rental_id} successfully activated for ${activationDays} days.`);
      setActivateTarget(null);
      fetchData();
    } catch (err) {
      setActivateTarget(null);
      setErrorMessage('Failed to activate reservation: ' + (err.message || 'Unknown error'));
    }
  };

  // Customer Cancellation Handler
  const confirmCancellation = async () => {
    if (!cancelTarget) return;
    try {
      await API.put(`/rentals/${cancelTarget.rental_id}/status`, {
        rental_status: 'Cancelled'
      });
      setFeedbackNotice(`Reservation #${cancelTarget.rental_id} cancelled. Equipment is now available.`);
      setCancelTarget(null);
      fetchData();
    } catch (err) {
      setCancelTarget(null);
      setErrorMessage('Failed to cancel reservation: ' + (err.message || 'Unknown error'));
    }
  };

  // Maintenance Completion Handler
  const confirmMaintenanceComplete = async () => {
    if (!maintenanceCompleteTarget) return;
    try {
      await API.put(`/maintenance/${maintenanceCompleteTarget.maintenance_id}/complete`);
      setFeedbackNotice(`Maintenance #${maintenanceCompleteTarget.maintenance_id} completed. Equipment restored to Available.`);
      setMaintenanceCompleteTarget(null);
      fetchData();
    } catch (err) {
      setMaintenanceCompleteTarget(null);
      setErrorMessage('Failed to complete maintenance: ' + (err.message || 'Unknown error'));
    }
  };

  // Admin User Management Handlers
  const handleRoleChange = async (userId, newRoleId) => {
    try {
      await API.put(`/users/${userId}/role`, { role_id: parseInt(newRoleId) });
      setFeedbackNotice(`Updated user #${userId} role.`);
      fetchData();
    } catch (err) {
      setErrorMessage('Failed to update user role: ' + (err.message || 'Unknown error'));
    }
  };

  const confirmUserDelete = async () => {
    if (!userDeleteTarget) return;
    try {
      await API.delete(`/users/${userDeleteTarget.user_id}`);
      setFeedbackNotice(`User ${userDeleteTarget.username} deleted.`);
      setUserDeleteTarget(null);
      fetchData();
    } catch (err) {
      setUserDeleteTarget(null);
      setErrorMessage('Failed to delete user account. You cannot delete your own active admin account.');
    }
  };

  const getRoleLabel = (roleId) => {
    switch (roleId) {
      case 1: return 'Admin';
      case 2: return 'Staff';
      case 3: return 'Technician';
      case 4: return 'Customer';
      default: return 'User';
    }
  };

  return (
    <div className="flex h-screen bg-slate-950 text-slate-100 font-sans overflow-hidden">
      {/* Sidebar */}
      <aside className="w-64 bg-slate-950 border-r border-slate-800/80 flex flex-col shrink-0">
        <div className="p-6 border-b border-slate-800/80 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-blue-600/20 border border-blue-500/30 flex items-center justify-center text-blue-400">
              <Wrench className="w-6 h-6" />
            </div>
            <div>
              <span className="text-lg font-bold tracking-wider text-white block">EquipRent</span>
              <span className="text-[11px] text-slate-400 tracking-wide uppercase font-medium">Rental Management</span>
            </div>
          </div>
        </div>

        {/* User Card */}
        <div className="p-4 mx-3 my-3 bg-slate-900/60 rounded-xl border border-slate-800/60">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-full bg-blue-600 flex items-center justify-center font-bold text-xs text-white uppercase shadow-sm">
              {(currentUser.first_name?.[0] || currentUser.email?.[0] || 'U')}
            </div>
            <div className="overflow-hidden flex-1">
              <p className="text-xs font-semibold text-white truncate">
                {currentUser.first_name ? `${currentUser.first_name} ${currentUser.last_name || ''}` : currentUser.email}
              </p>
              <div className="flex items-center gap-1.5 mt-0.5">
                <span className={`inline-block w-2 h-2 rounded-full ${
                  currentUser.role_id === 1 ? 'bg-amber-400' :
                  currentUser.role_id === 2 ? 'bg-blue-400' :
                  currentUser.role_id === 3 ? 'bg-cyan-400' : 'bg-purple-400'
                }`} />
                <span className="text-[11px] text-slate-400 font-medium">
                  {getRoleLabel(currentUser.role_id)}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Navigation Tabs */}
        <nav className="flex-1 px-3 space-y-1.5 overflow-y-auto">
          {/* COMBINED FRONTEND & BACKEND OPERATIONS TAB */}
          <button
            onClick={() => setActiveTab('operations')}
            className={`w-full flex items-center justify-between px-3.5 py-2.5 rounded-xl transition text-sm font-medium ${
              activeTab === 'operations' 
                ? 'bg-blue-600 text-white shadow-lg shadow-blue-600/25' 
                : 'text-slate-300 hover:bg-slate-900 hover:text-white'
            }`}
          >
            <div className="flex items-center gap-2.5">
              <Layers className="w-4 h-4 text-inherit" />
              <span>Equipment & Rentals</span>
            </div>
            <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-md ${
              activeTab === 'operations' ? 'bg-blue-700 text-white' : 'bg-slate-800 text-slate-400'
            }`}>
              {equipment.length}
            </span>
          </button>

          <button
            onClick={() => setActiveTab('maintenance')}
            className={`w-full flex items-center justify-between px-3.5 py-2.5 rounded-xl transition text-sm font-medium ${
              activeTab === 'maintenance' 
                ? 'bg-blue-600 text-white shadow-lg shadow-blue-600/25' 
                : 'text-slate-300 hover:bg-slate-900 hover:text-white'
            }`}
          >
            <div className="flex items-center gap-2.5">
              <ClipboardList className="w-4 h-4 text-inherit" />
              <span>Maintenance</span>
            </div>
            {stats.underMaintenance > 0 && (
              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-md bg-amber-500/20 text-amber-300 border border-amber-500/30">
                {stats.underMaintenance}
              </span>
            )}
          </button>

          <button
            onClick={() => setActiveTab('audit')}
            className={`w-full flex items-center gap-2.5 px-3.5 py-2.5 rounded-xl transition text-sm font-medium ${
              activeTab === 'audit' 
                ? 'bg-blue-600 text-white shadow-lg shadow-blue-600/25' 
                : 'text-slate-300 hover:bg-slate-900 hover:text-white'
            }`}
          >
            <Activity className="w-4 h-4 text-inherit" />
            <span>Audit Logs</span>
          </button>

          {currentUser.role_id === 1 && (
            <button
              onClick={() => setActiveTab('users')}
              className={`w-full flex items-center justify-between px-3.5 py-2.5 rounded-xl transition text-sm font-medium ${
                activeTab === 'users' 
                  ? 'bg-blue-600 text-white shadow-lg shadow-blue-600/25' 
                  : 'text-slate-300 hover:bg-slate-900 hover:text-white'
              }`}
            >
              <div className="flex items-center gap-2.5">
                <Users className="w-4 h-4 text-inherit" />
                <span>Users & Roles</span>
              </div>
              <span className="text-[10px] bg-slate-800 text-slate-400 font-semibold px-1.5 py-0.5 rounded">
                {users.length}
              </span>
            </button>
          )}
        </nav>

        {/* Footer */}
        <div className="p-4 border-t border-slate-800/80 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
            <span className="text-xs text-slate-400">Live PostgreSQL</span>
          </div>
          {onLogout && (
            <button 
              onClick={onLogout}
              className="text-xs bg-rose-600/15 hover:bg-rose-600 text-rose-300 hover:text-white px-3 py-1.5 rounded-lg transition border border-rose-500/30 font-medium"
            >
              Logout
            </button>
          )}
        </div>
      </aside>

      {/* Main Content Area */}
      <main className="flex-1 flex flex-col overflow-hidden bg-slate-900/60">
        {/* Top Header */}
        <header className="h-18 bg-slate-950/80 backdrop-blur border-b border-slate-800 px-8 flex items-center justify-between shrink-0">
          <div>
            <h1 className="text-xl font-bold text-white flex items-center gap-2.5">
              {activeTab === 'operations' ? 'Equipment & Rentals Management' : 
               activeTab === 'maintenance' ? 'Maintenance Management' :
               activeTab === 'audit' ? 'System Audit Trail' : 'User & Access Management'}
            </h1>
            <p className="text-xs text-slate-400 mt-0.5">
              {activeTab === 'operations' 
                ? 'Unified inventory catalog with live rental, reservation, and checkout operations' 
                : 'EquipRent enterprise operations dashboard'}
            </p>
          </div>

          <div className="flex items-center gap-3">
            {activeTab === 'operations' && (currentUser.role_id === 1 || currentUser.role_id === 2) && (
              <button 
                onClick={handleOpenCreateModal}
                className="flex items-center gap-2 bg-blue-600 hover:bg-blue-500 text-white px-3.5 py-2 rounded-xl transition font-medium text-xs shadow-lg shadow-blue-600/20"
              >
                <PlusCircle className="w-4 h-4" /> Add Equipment
              </button>
            )}
            <button 
              onClick={fetchData}
              className="flex items-center gap-2 bg-slate-800/80 hover:bg-slate-700 text-slate-200 px-3.5 py-2 rounded-xl transition border border-slate-700/80 text-xs font-medium"
              title="Refresh Data"
            >
              <RefreshCcw className={`w-3.5 h-3.5 ${loading ? 'animate-spin text-blue-400' : ''}`} /> Refresh
            </button>
          </div>
        </header>

        {/* Success Feedback Notification Pill */}
        {feedbackNotice && (
          <div className="mx-8 mt-4 bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 px-4 py-2.5 rounded-xl flex items-center justify-between shadow-lg backdrop-blur text-xs animate-in fade-in slide-in-from-top duration-200">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
              <span>{feedbackNotice}</span>
            </div>
            <button onClick={() => setFeedbackNotice(null)} className="text-emerald-400/80 hover:text-emerald-200">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {/* Dynamic Tab Body */}
        <div className="flex-1 overflow-y-auto p-8 space-y-6">
          {loading ? (
            <div className="flex flex-col justify-center items-center h-64 text-slate-400 gap-3">
              <div className="w-7 h-7 border-2 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
              <p className="text-sm font-medium">Syncing live cloud records from database...</p>
            </div>
          ) : (
            <>
              {/* ============================================================== */}
              {/* COMBINED OPERATIONS TAB (UNIFIED FRONTEND & BACKEND TABLE)     */}
              {/* ============================================================== */}
              {activeTab === 'operations' && (
                <div className="space-y-6">
                  {/* Summary Metric Cards */}
                  <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                    <div 
                      onClick={() => setStatusFilter('All')}
                      className={`p-4 rounded-xl border cursor-pointer transition ${
                        statusFilter === 'All' 
                          ? 'bg-slate-900 border-blue-500/50 shadow-md shadow-blue-500/10' 
                          : 'bg-slate-950/70 border-slate-800 hover:border-slate-700'
                      }`}
                    >
                      <p className="text-slate-400 text-xs font-medium">Total Inventory</p>
                      <p className="text-2xl font-bold text-white mt-1">{stats.total}</p>
                    </div>

                    <div 
                      onClick={() => setStatusFilter('Available')}
                      className={`p-4 rounded-xl border cursor-pointer transition ${
                        statusFilter === 'Available' 
                          ? 'bg-slate-900 border-emerald-500/50 shadow-md shadow-emerald-500/10' 
                          : 'bg-slate-950/70 border-slate-800 hover:border-slate-700'
                      }`}
                    >
                      <p className="text-slate-400 text-xs font-medium">Available Now</p>
                      <p className="text-2xl font-bold text-emerald-400 mt-1">{stats.available}</p>
                    </div>

                    <div 
                      onClick={() => setStatusFilter('Reserved')}
                      className={`p-4 rounded-xl border cursor-pointer transition ${
                        statusFilter === 'Reserved' 
                          ? 'bg-slate-900 border-purple-500/50 shadow-md shadow-purple-500/10' 
                          : 'bg-slate-950/70 border-slate-800 hover:border-slate-700'
                      }`}
                    >
                      <p className="text-slate-400 text-xs font-medium">Counter Holds / Reserved</p>
                      <p className="text-2xl font-bold text-purple-400 mt-1">{stats.reserved}</p>
                    </div>

                    <div 
                      onClick={() => setStatusFilter('Rented')}
                      className={`p-4 rounded-xl border cursor-pointer transition ${
                        statusFilter === 'Rented' 
                          ? 'bg-slate-900 border-blue-500/50 shadow-md shadow-blue-500/10' 
                          : 'bg-slate-950/70 border-slate-800 hover:border-slate-700'
                      }`}
                    >
                      <p className="text-slate-400 text-xs font-medium">Active Rentals</p>
                      <p className="text-2xl font-bold text-blue-400 mt-1">{stats.rented}</p>
                    </div>

                    <div 
                      onClick={() => setStatusFilter('Under Maintenance')}
                      className={`p-4 rounded-xl border cursor-pointer transition ${
                        statusFilter === 'Under Maintenance' 
                          ? 'bg-slate-900 border-amber-500/50 shadow-md shadow-amber-500/10' 
                          : 'bg-slate-950/70 border-slate-800 hover:border-slate-700'
                      }`}
                    >
                      <p className="text-slate-400 text-xs font-medium">Under Maintenance</p>
                      <p className="text-2xl font-bold text-amber-400 mt-1">{stats.underMaintenance}</p>
                    </div>
                  </div>

                  {/* View Mode Toggle & Filter Bar */}
                  <div className="bg-slate-950 border border-slate-800/80 rounded-2xl p-4 space-y-4">
                    <div className="flex flex-col lg:flex-row items-stretch lg:items-center justify-between gap-4">
                      {/* View Mode Selector */}
                      <div className="inline-flex p-1 bg-slate-900 rounded-xl border border-slate-800 self-start">
                        <button
                          onClick={() => setOperationsView('combined')}
                          className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold transition ${
                            operationsView === 'combined'
                              ? 'bg-blue-600 text-white shadow-sm'
                              : 'text-slate-400 hover:text-white'
                          }`}
                        >
                          <Layers className="w-3.5 h-3.5" />
                          Live Combined Operations Table
                        </button>
                        <button
                          onClick={() => setOperationsView('ledger')}
                          className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold transition ${
                            operationsView === 'ledger'
                              ? 'bg-blue-600 text-white shadow-sm'
                              : 'text-slate-400 hover:text-white'
                          }`}
                        >
                          <ShoppingCart className="w-3.5 h-3.5" />
                          Full Rental Contracts Ledger ({rentals.length})
                        </button>
                      </div>

                      {/* Search Bar */}
                      <div className="flex-1 max-w-md relative">
                        <Search className="w-4 h-4 text-slate-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
                        <input
                          type="text"
                          value={searchQuery}
                          onChange={(e) => setSearchQuery(e.target.value)}
                          placeholder="Search item, category, customer name..."
                          className="w-full bg-slate-900 border border-slate-800 rounded-xl pl-9 pr-4 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-blue-500 transition"
                        />
                        {searchQuery && (
                          <button
                            onClick={() => setSearchQuery('')}
                            className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300"
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>

                      {/* Category Dropdown */}
                      <div className="flex items-center gap-2">
                        <Filter className="w-3.5 h-3.5 text-slate-400" />
                        <select
                          value={selectedCategory}
                          onChange={(e) => setSelectedCategory(e.target.value)}
                          className="bg-slate-900 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-300 focus:outline-none focus:border-blue-500"
                        >
                          <option value="All">All Categories</option>
                          {categories.map((c) => (
                            <option key={c.category_id} value={c.category_id}>
                              {c.category_name}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>

                    {/* Quick Filter Status Pills */}
                    {operationsView === 'combined' && (
                      <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-slate-800/60">
                        <span className="text-[11px] text-slate-400 font-medium mr-1">Status Filter:</span>
                        {[
                          { key: 'All', label: 'All Items', count: stats.total },
                          { key: 'Available', label: 'Available', count: stats.available },
                          { key: 'Reserved', label: 'Reserved / On Hold', count: stats.reserved },
                          { key: 'Rented', label: 'Active Rentals', count: stats.rented },
                          { key: 'Under Maintenance', label: 'In Maintenance', count: stats.underMaintenance },
                          ...(currentUser.role_id === 4 ? [{ key: 'My Items', label: 'My Bookings', count: stats.myItems }] : [])
                        ].map((filter) => (
                          <button
                            key={filter.key}
                            onClick={() => setStatusFilter(filter.key)}
                            className={`px-3 py-1 rounded-lg text-xs font-medium transition flex items-center gap-1.5 ${
                              statusFilter === filter.key
                                ? 'bg-blue-600/30 text-blue-300 border border-blue-500/50'
                                : 'bg-slate-900 text-slate-400 hover:text-slate-200 border border-slate-800'
                            }`}
                          >
                            <span>{filter.label}</span>
                            <span className="text-[10px] bg-slate-800/80 px-1.5 py-0.2 rounded-full font-bold">
                              {filter.count}
                            </span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* ========================================================== */}
                  {/* 1. THE UNIFIED COMBINED TABLE                              */}
                  {/* ========================================================== */}
                  {operationsView === 'combined' && (
                    <div className="bg-slate-950 border border-slate-800 rounded-2xl overflow-hidden shadow-xl">
                      <div className="px-6 py-4 bg-slate-900/40 border-b border-slate-800 flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <Layers className="w-4 h-4 text-blue-400" />
                          <h2 className="text-sm font-semibold text-white">
                            Unified Equipment & Rental Operations
                          </h2>
                          <span className="text-xs text-slate-400 ml-2">
                            ({filteredEquipment.length} {filteredEquipment.length === 1 ? 'item' : 'items'} displayed)
                          </span>
                        </div>
                        <span className="text-xs text-slate-400">
                          {currentUser.role_id === 4 ? 'Browse catalog & reserve online' : 'Manage equipment, checkout & returns'}
                        </span>
                      </div>

                      <div className="overflow-x-auto">
                        <table className="w-full text-left border-collapse">
                          <thead>
                            <tr className="border-b border-slate-800 text-slate-400 text-xs uppercase tracking-wider bg-slate-900/60">
                              <th className="p-4 font-semibold">Equipment / Model</th>
                              <th className="p-4 font-semibold">Category & Condition</th>
                              <th className="p-4 font-semibold">Daily Rate</th>
                              <th className="p-4 font-semibold">Live Status</th>
                              <th className="p-4 font-semibold">Active Rental & Customer Details</th>
                              <th className="p-4 font-semibold text-right">Actions</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-800/80 text-sm">
                            {filteredEquipment.length === 0 ? (
                              <tr>
                                <td colSpan="6" className="p-12 text-center text-slate-500">
                                  No equipment items match the selected filters or search query.
                                </td>
                              </tr>
                            ) : (
                              filteredEquipment.map((item) => {
                                const activeRental = findActiveRental(item.equipment_id);
                                const activeMaint = findActiveMaintenance(item.equipment_id);
                                const isMine = isUserRental(activeRental);

                                return (
                                  <tr 
                                    key={item.equipment_id} 
                                    className={`transition ${
                                      isMine ? 'bg-purple-950/20 hover:bg-purple-950/30' : 'hover:bg-slate-900/40'
                                    }`}
                                  >
                                    {/* 1. Equipment / Model */}
                                    <td className="p-4">
                                      <div className="flex items-start gap-2.5">
                                        <span className="font-mono text-xs font-semibold text-blue-400 mt-0.5">
                                          #{item.equipment_id}
                                        </span>
                                        <div>
                                          <p className="font-semibold text-white leading-snug">
                                            {item.equipment_name}
                                          </p>
                                          {item.description && (
                                            <p className="text-xs text-slate-400 line-clamp-1 mt-0.5">
                                              {item.description}
                                            </p>
                                          )}
                                        </div>
                                      </div>
                                    </td>

                                    {/* 2. Category & Condition */}
                                    <td className="p-4">
                                      <div className="space-y-1">
                                        <span className="inline-block text-xs bg-slate-900 border border-slate-800 text-slate-300 px-2 py-0.5 rounded font-medium">
                                          {item.category?.category_name || 'General'}
                                        </span>
                                        <div className="text-[11px] text-slate-400">
                                          Condition: <span className={`font-semibold ${
                                            item.condition_status === 'Excellent' || item.condition_status === 'Good' 
                                              ? 'text-emerald-400' 
                                              : item.condition_status === 'Fair' 
                                              ? 'text-amber-400' 
                                              : 'text-rose-400'
                                          }`}>{item.condition_status}</span>
                                        </div>
                                      </div>
                                    </td>

                                    {/* 3. Daily Rate */}
                                    <td className="p-4">
                                      <div className="font-semibold text-emerald-400">
                                        ₱{parseFloat(item.rental_price).toFixed(2)}
                                      </div>
                                      <span className="text-[11px] text-slate-400">/ day</span>
                                    </td>

                                    {/* 4. Live Status */}
                                    <td className="p-4">
                                      <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold border ${
                                        item.equipment_status === 'Available' ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' :
                                        item.equipment_status === 'Reserved' ? 'bg-purple-500/15 text-purple-300 border-purple-500/30' :
                                        item.equipment_status === 'Rented' ? 'bg-blue-500/15 text-blue-300 border-blue-500/30' :
                                        'bg-amber-500/15 text-amber-300 border-amber-500/30'
                                      }`}>
                                        {item.equipment_status === 'Available' && <CheckCircle2 className="w-3 h-3" />}
                                        {item.equipment_status === 'Reserved' && <Clock className="w-3 h-3" />}
                                        {item.equipment_status === 'Rented' && <ShoppingCart className="w-3 h-3" />}
                                        {item.equipment_status === 'Under Maintenance' && <Wrench className="w-3 h-3" />}
                                        {item.equipment_status}
                                      </span>
                                    </td>

                                    {/* 5. Combined Active Rental & Customer Details */}
                                    <td className="p-4">
                                      {item.equipment_status === 'Available' && (
                                        <div className="flex items-center gap-1.5 text-xs text-slate-400">
                                          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                                          <span>Ready for immediate booking</span>
                                        </div>
                                      )}

                                      {item.equipment_status === 'Reserved' && (
                                        <div className="space-y-1">
                                          <div className="flex items-center gap-1.5 text-xs font-semibold text-purple-300">
                                            <Clock className="w-3.5 h-3.5 text-purple-400 shrink-0" />
                                            <span>24-Hour Counter Hold</span>
                                            {activeRental && (
                                              <span className="font-mono text-[11px] text-purple-400/80">
                                                (Ref #{activeRental.rental_id})
                                              </span>
                                            )}
                                          </div>
                                          {activeRental?.customer?.user ? (
                                            <div className="text-xs text-slate-300">
                                              Renter:{' '}
                                              <strong className="text-white">
                                                {activeRental.customer.user.first_name} {activeRental.customer.user.last_name}
                                              </strong>
                                              {isMine && (
                                                <span className="ml-1.5 text-[10px] bg-purple-500/20 text-purple-300 border border-purple-500/30 px-1.5 py-0.2 rounded font-bold">
                                                  YOU
                                                </span>
                                              )}
                                            </div>
                                          ) : (
                                            <div className="text-xs text-purple-300/80 italic">Online reservation placed</div>
                                          )}
                                        </div>
                                      )}

                                      {item.equipment_status === 'Rented' && (
                                        <div className="space-y-1">
                                          <div className="flex items-center gap-1.5 text-xs font-semibold text-blue-300">
                                            <ShoppingCart className="w-3.5 h-3.5 text-blue-400 shrink-0" />
                                            <span>Active Rental Contract</span>
                                            {activeRental && (
                                              <span className="font-mono text-[11px] text-blue-400/80">
                                                (Ref #{activeRental.rental_id})
                                              </span>
                                            )}
                                          </div>
                                          {activeRental?.customer?.user && (
                                            <div className="text-xs text-slate-300">
                                              Customer:{' '}
                                              <strong className="text-white">
                                                {activeRental.customer.user.first_name} {activeRental.customer.user.last_name}
                                              </strong>
                                              {isMine && (
                                                <span className="ml-1.5 text-[10px] bg-blue-500/20 text-blue-300 border border-blue-500/30 px-1.5 py-0.2 rounded font-bold">
                                                  YOU
                                                </span>
                                              )}
                                            </div>
                                          )}
                                          <div className="text-[11px] text-slate-400 flex items-center gap-2">
                                            {activeRental?.expected_return_date && (
                                              <span>Due: {new Date(activeRental.expected_return_date).toLocaleDateString()}</span>
                                            )}
                                            {activeRental?.staff && (
                                              <span>• Staff: {activeRental.staff.first_name}</span>
                                            )}
                                          </div>
                                        </div>
                                      )}

                                      {item.equipment_status === 'Under Maintenance' && (
                                        <div className="space-y-1">
                                          <div className="flex items-center gap-1.5 text-xs font-semibold text-amber-300">
                                            <Wrench className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                                            <span>Under Service</span>
                                          </div>
                                          <p className="text-xs text-slate-300 line-clamp-1">
                                            {activeMaint?.description || 'Routine equipment servicing'}
                                          </p>
                                        </div>
                                      )}
                                    </td>

                                    {/* 6. Combined Role Actions */}
                                    <td className="p-4 text-right">
                                      <div className="flex items-center justify-end gap-2">
                                        {/* ======================================= */}
                                        {/* CUSTOMER ACTIONS (Role 4)               */}
                                        {/* ======================================= */}
                                        {currentUser.role_id === 4 && (
                                          <>
                                            {item.equipment_status === 'Available' && (
                                              <button
                                                onClick={() => handleReserveItem(item)}
                                                className="bg-purple-600/25 hover:bg-purple-600 text-purple-300 hover:text-white px-3 py-1.5 rounded-lg text-xs font-semibold border border-purple-500/30 transition flex items-center gap-1.5 shadow-sm"
                                                title="Reserve Online from Home (24h Hold)"
                                              >
                                                <ShoppingCart className="w-3.5 h-3.5" /> Reserve Online
                                              </button>
                                            )}

                                            {item.equipment_status === 'Reserved' && isMine && activeRental && (
                                              <button
                                                onClick={() => setCancelTarget(activeRental)}
                                                className="bg-rose-600/20 hover:bg-rose-600 text-rose-300 hover:text-white px-3 py-1.5 rounded-lg text-xs font-semibold border border-rose-500/30 transition flex items-center gap-1.5"
                                                title="Cancel your reservation hold"
                                              >
                                                <Ban className="w-3.5 h-3.5" /> Cancel Hold
                                              </button>
                                            )}

                                            {item.equipment_status === 'Reserved' && !isMine && (
                                              <span className="text-xs text-slate-500 italic">Held by customer</span>
                                            )}

                                            {item.equipment_status === 'Rented' && isMine && (
                                              <span className="text-xs text-blue-400 font-medium">In your possession</span>
                                            )}

                                            {item.equipment_status === 'Rented' && !isMine && (
                                              <span className="text-xs text-slate-500 italic">Currently rented</span>
                                            )}

                                            {item.equipment_status === 'Under Maintenance' && (
                                              <span className="text-xs text-slate-500 italic">Unavailable</span>
                                            )}
                                          </>
                                        )}

                                        {/* ======================================= */}
                                        {/* STAFF & ADMIN ACTIONS (Roles 1 & 2)     */}
                                        {/* ======================================= */}
                                        {(currentUser.role_id === 1 || currentUser.role_id === 2) && (
                                          <>
                                            {/* Activate Counter Checkouts */}
                                            {item.equipment_status === 'Reserved' && activeRental && (
                                              <button
                                                onClick={() => setActivateTarget(activeRental)}
                                                className="bg-purple-600/25 hover:bg-purple-600 text-purple-300 hover:text-white px-3 py-1.5 rounded-lg text-xs font-semibold border border-purple-500/30 transition flex items-center gap-1.5 shadow-sm"
                                                title="Customer arrived at counter: activate and check out"
                                              >
                                                <CheckCircle2 className="w-3.5 h-3.5" /> Activate at Counter
                                              </button>
                                            )}

                                            {/* Return Active Rentals */}
                                            {item.equipment_status === 'Rented' && activeRental && (
                                              <button
                                                onClick={() => setReturnTarget(activeRental)}
                                                className="bg-emerald-600/25 hover:bg-emerald-600 text-emerald-300 hover:text-white px-3 py-1.5 rounded-lg text-xs font-semibold border border-emerald-500/30 transition flex items-center gap-1.5 shadow-sm"
                                                title="Process equipment return"
                                              >
                                                <CheckCircle2 className="w-3.5 h-3.5" /> Return Equipment
                                              </button>
                                            )}

                                            {/* Complete Maintenance */}
                                            {item.equipment_status === 'Under Maintenance' && activeMaint && (
                                              <button
                                                onClick={() => setMaintenanceCompleteTarget(activeMaint)}
                                                className="bg-blue-600/25 hover:bg-blue-600 text-blue-300 hover:text-white px-3 py-1.5 rounded-lg text-xs font-semibold border border-blue-500/30 transition flex items-center gap-1.5 shadow-sm"
                                                title="Mark maintenance complete"
                                              >
                                                <CheckCircle2 className="w-3.5 h-3.5" /> Complete Service
                                              </button>
                                            )}

                                            {/* Edit & Delete Controls */}
                                            <button 
                                              onClick={() => handleOpenEditModal(item)}
                                              className="p-1.5 hover:bg-slate-800 rounded-lg text-slate-400 hover:text-blue-400 transition"
                                              title="Edit Equipment Details"
                                            >
                                              <Pencil className="w-3.5 h-3.5" />
                                            </button>

                                            {currentUser.role_id === 1 && (
                                              <button 
                                                onClick={() => setDeleteTarget(item)}
                                                className="p-1.5 hover:bg-slate-800 rounded-lg text-slate-400 hover:text-rose-400 transition"
                                                title="Delete Equipment"
                                              >
                                                <Trash2 className="w-3.5 h-3.5" />
                                              </button>
                                            )}
                                          </>
                                        )}

                                        {/* ======================================= */}
                                        {/* TECHNICIAN ACTIONS (Role 3)             */}
                                        {/* ======================================= */}
                                        {currentUser.role_id === 3 && item.equipment_status === 'Under Maintenance' && activeMaint && (
                                          <button
                                            onClick={() => setMaintenanceCompleteTarget(activeMaint)}
                                            className="bg-blue-600/25 hover:bg-blue-600 text-blue-300 hover:text-white px-3 py-1.5 rounded-lg text-xs font-semibold border border-blue-500/30 transition flex items-center gap-1.5 shadow-sm"
                                            title="Mark maintenance complete"
                                          >
                                            <CheckCircle2 className="w-3.5 h-3.5" /> Complete Service
                                          </button>
                                        )}
                                      </div>
                                    </td>
                                  </tr>
                                );
                              })
                            )}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}

                  {/* ========================================================== */}
                  {/* 2. FULL RENTAL CONTRACTS LEDGER (HISTORICAL VIEW)           */}
                  {/* ========================================================== */}
                  {operationsView === 'ledger' && (
                    <div className="bg-slate-950 border border-slate-800 rounded-2xl overflow-hidden shadow-xl">
                      <div className="px-6 py-4 bg-slate-900/40 border-b border-slate-800 flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <ShoppingCart className="w-4 h-4 text-blue-400" />
                          <h2 className="text-sm font-semibold text-white">
                            All Rental Contracts Ledger
                          </h2>
                          <span className="text-xs text-slate-400 ml-2">
                            ({rentals.length} total records)
                          </span>
                        </div>
                        <span className="text-xs text-slate-400">
                          Complete audit log of active, reserved, returned, and cancelled agreements
                        </span>
                      </div>

                      <div className="overflow-x-auto">
                        <table className="w-full text-left border-collapse">
                          <thead>
                            <tr className="border-b border-slate-800 text-slate-400 text-xs uppercase tracking-wider bg-slate-900/60">
                              <th className="p-4 font-semibold">Rental ID</th>
                              <th className="p-4 font-semibold">Customer</th>
                              <th className="p-4 font-semibold">Staff Handler</th>
                              <th className="p-4 font-semibold">Items Rented</th>
                              <th className="p-4 font-semibold">Dates / Expiry</th>
                              <th className="p-4 font-semibold">Total Amount</th>
                              <th className="p-4 font-semibold">Status</th>
                              <th className="p-4 font-semibold text-right">Action</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-800/80 text-sm">
                            {rentals.length === 0 ? (
                              <tr>
                                <td colSpan="8" className="p-8 text-center text-slate-500">No rental records found.</td>
                              </tr>
                            ) : (
                              rentals.map((r) => (
                                <tr key={r.rental_id} className="hover:bg-slate-900/40 transition">
                                  <td className="p-4 font-mono font-medium text-white">#{r.rental_id}</td>
                                  <td className="p-4 text-slate-300">
                                    {r.customer?.user?.first_name} {r.customer?.user?.last_name}
                                  </td>
                                  <td className="p-4 text-slate-300">
                                    {r.staff ? `${r.staff.first_name} ${r.staff.last_name}` : (
                                      <span className="text-purple-400 italic text-xs">Online Reservation</span>
                                    )}
                                  </td>
                                  <td className="p-4 text-slate-200">
                                    {r.rental_items && r.rental_items.length > 0 ? (
                                      <div className="flex flex-wrap gap-1.5">
                                        {r.rental_items.map((ri, idx) => (
                                          <span key={idx} className="text-xs bg-slate-900 px-2 py-0.5 rounded border border-slate-800 text-slate-300">
                                            {ri.equipment?.equipment_name || 'Equipment'} <strong className="text-blue-400 font-mono">(#{ri.equipment_id})</strong>
                                          </span>
                                        ))}
                                      </div>
                                    ) : (
                                      <span className="text-slate-500 italic">No items linked</span>
                                    )}
                                  </td>
                                  <td className="p-4 text-slate-300 text-xs">
                                    {r.rental_status === 'Reserved' ? (
                                      <span className="text-purple-400 font-medium flex items-center gap-1">
                                        <Clock className="w-3.5 h-3.5" /> 24hr Limit
                                      </span>
                                    ) : (
                                      `Due: ${new Date(r.expected_return_date).toLocaleDateString()}`
                                    )}
                                  </td>
                                  <td className="p-4 font-semibold text-emerald-400">₱{parseFloat(r.total_amount).toFixed(2)}</td>
                                  <td className="p-4">
                                    <span className={`px-2.5 py-1 rounded-full text-xs font-semibold border ${
                                      r.rental_status === 'Reserved' ? 'bg-purple-500/10 text-purple-400 border-purple-500/20' :
                                      r.rental_status === 'Active' ? 'bg-blue-500/10 text-blue-400 border-blue-500/20' : 
                                      r.rental_status === 'Returned' ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' :
                                      'bg-slate-800 text-slate-400 border-slate-700'
                                    }`}>
                                      {r.rental_status}
                                    </span>
                                  </td>
                                  <td className="p-4 text-right">
                                    {r.rental_status === 'Reserved' && currentUser.role_id === 4 && (
                                      <button
                                        onClick={() => setCancelTarget(r)}
                                        className="bg-rose-600/20 hover:bg-rose-600 text-rose-300 hover:text-white px-3 py-1.5 rounded-lg transition text-xs font-semibold border border-rose-500/30 ml-auto"
                                      >
                                        Cancel Hold
                                      </button>
                                    )}

                                    {r.rental_status === 'Reserved' && (currentUser.role_id === 1 || currentUser.role_id === 2) && (
                                      <button
                                        onClick={() => setActivateTarget(r)}
                                        className="bg-purple-600/20 hover:bg-purple-600 text-purple-300 hover:text-white px-3 py-1.5 rounded-lg transition text-xs font-semibold border border-purple-500/30 ml-auto"
                                      >
                                        Activate at Counter
                                      </button>
                                    )}

                                    {r.rental_status === 'Active' && (currentUser.role_id === 1 || currentUser.role_id === 2) && (
                                      <button
                                        onClick={() => setReturnTarget(r)}
                                        className="bg-emerald-600/20 hover:bg-emerald-600 text-emerald-300 hover:text-white px-3 py-1.5 rounded-lg transition text-xs font-semibold border border-emerald-500/30 ml-auto"
                                      >
                                        Return Equipment
                                      </button>
                                    )}
                                  </td>
                                </tr>
                              ))
                            )}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* ============================================================== */}
              {/* MAINTENANCE TAB                                                */}
              {/* ============================================================== */}
              {activeTab === 'maintenance' && (
                <div className="space-y-6">
                  <div className="bg-slate-950 border border-slate-800 rounded-2xl overflow-hidden shadow-xl">
                    <div className="px-6 py-4 bg-slate-900/40 border-b border-slate-800 flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <ClipboardList className="w-4 h-4 text-blue-400" />
                        <h2 className="text-sm font-semibold text-white">Maintenance Records</h2>
                        <span className="text-xs text-slate-400 ml-2">({maintenance.length} records)</span>
                      </div>
                    </div>

                    <table className="w-full text-left border-collapse">
                      <thead>
                        <tr className="border-b border-slate-800 text-slate-400 text-xs uppercase tracking-wider bg-slate-900/60">
                          <th className="p-4 font-semibold">ID</th>
                          <th className="p-4 font-semibold">Equipment Item</th>
                          <th className="p-4 font-semibold">Description</th>
                          <th className="p-4 font-semibold">Status</th>
                          <th className="p-4 font-semibold">Date</th>
                          <th className="p-4 font-semibold text-right">Action</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-800/80 text-sm">
                        {maintenance.length === 0 ? (
                          <tr>
                            <td colSpan="6" className="p-8 text-center text-slate-500">No active maintenance records found.</td>
                          </tr>
                        ) : (
                          maintenance.map((m) => (
                            <tr key={m.maintenance_id} className="hover:bg-slate-900/40 transition">
                              <td className="p-4 font-medium text-white">#{m.maintenance_id}</td>
                              <td className="p-4 text-slate-300">
                                {m.equipment?.equipment_name || `Equipment #${m.equipment_id}`}
                                <span className="font-mono text-blue-400 text-xs ml-1">(#{m.equipment_id})</span>
                              </td>
                              <td className="p-4 text-slate-300">{m.description}</td>
                              <td className="p-4">
                                <span className={`px-2.5 py-1 rounded-full text-xs font-semibold border ${
                                  m.maintenance_status === 'Completed' 
                                    ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' 
                                    : 'bg-amber-500/10 text-amber-400 border-amber-500/20'
                                }`}>
                                  {m.maintenance_status}
                                </span>
                              </td>
                              <td className="p-4 text-slate-400 text-xs">{new Date(m.maintenance_date).toLocaleDateString()}</td>
                              <td className="p-4 text-right">
                                {m.maintenance_status !== 'Completed' && (currentUser.role_id === 1 || currentUser.role_id === 2 || currentUser.role_id === 3) && (
                                  <button
                                    onClick={() => setMaintenanceCompleteTarget(m)}
                                    className="flex items-center gap-1.5 bg-blue-600/20 hover:bg-blue-600 text-blue-300 hover:text-white px-3 py-1.5 rounded-lg transition text-xs font-semibold border border-blue-500/30 ml-auto"
                                  >
                                    <CheckCircle2 className="w-3.5 h-3.5" /> Complete Service
                                  </button>
                                )}
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* ============================================================== */}
              {/* AUDIT LOGS TAB                                                 */}
              {/* ============================================================== */}
              {activeTab === 'audit' && (
                <div className="space-y-6">
                  <div className="bg-slate-950 border border-slate-800 rounded-2xl overflow-hidden shadow-xl">
                    <div className="px-6 py-4 bg-slate-900/40 border-b border-slate-800 flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Activity className="w-4 h-4 text-blue-400" />
                        <h2 className="text-sm font-semibold text-white">System Audit Trail</h2>
                        <span className="text-xs text-slate-400 ml-2">({auditLogs.length} events recorded)</span>
                      </div>
                    </div>

                    <table className="w-full text-left border-collapse">
                      <thead>
                        <tr className="border-b border-slate-800 text-slate-400 text-xs uppercase tracking-wider bg-slate-900/60">
                          <th className="p-4 font-semibold">Audit ID</th>
                          <th className="p-4 font-semibold">Action</th>
                          <th className="p-4 font-semibold">Table</th>
                          <th className="p-4 font-semibold">Record ID</th>
                          <th className="p-4 font-semibold">Timestamp</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-800/80 text-sm">
                        {auditLogs.map((log) => (
                          <tr key={log.audit_id} className="hover:bg-slate-900/40 transition">
                            <td className="p-4 font-mono font-medium text-white">#{log.audit_id}</td>
                            <td className="p-4">
                              <span className={`px-2 py-0.5 rounded text-xs font-bold ${
                                log.action === 'INSERT' ? 'bg-emerald-500/20 text-emerald-400' : 
                                log.action === 'UPDATE' ? 'bg-blue-500/20 text-blue-400' : 'bg-rose-500/20 text-rose-400'
                              }`}>
                                {log.action}
                              </span>
                            </td>
                            <td className="p-4 text-slate-300 font-mono text-xs">{log.table_name}</td>
                            <td className="p-4 text-slate-300 font-mono text-xs">#{log.record_id}</td>
                            <td className="p-4 text-slate-400 text-xs">{new Date(log.created_at).toLocaleString()}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* ============================================================== */}
              {/* USERS TAB (ADMIN ONLY)                                         */}
              {/* ============================================================== */}
              {activeTab === 'users' && currentUser.role_id === 1 && (
                <div className="space-y-6">
                  <div className="bg-slate-950 border border-slate-800 rounded-2xl overflow-hidden shadow-xl">
                    <div className="px-6 py-4 bg-slate-900/40 border-b border-slate-800 flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Users className="w-4 h-4 text-blue-400" />
                        <h2 className="text-sm font-semibold text-white">Users & Role Assignments</h2>
                        <span className="text-xs text-slate-400 ml-2">({users.length} registered accounts)</span>
                      </div>
                    </div>

                    <table className="w-full text-left border-collapse">
                      <thead>
                        <tr className="border-b border-slate-800 text-slate-400 text-xs uppercase tracking-wider bg-slate-900/60">
                          <th className="p-4 font-semibold">Name</th>
                          <th className="p-4 font-semibold">Username</th>
                          <th className="p-4 font-semibold">Email</th>
                          <th className="p-4 font-semibold">Role Control</th>
                          <th className="p-4 font-semibold text-right">Actions</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-800/80 text-sm">
                        {users.map((u) => (
                          <tr key={u.user_id} className="hover:bg-slate-900/40 transition">
                            <td className="p-4 font-medium text-white">{u.first_name} {u.last_name}</td>
                            <td className="p-4 text-slate-300 font-mono text-xs">{u.username}</td>
                            <td className="p-4 text-slate-300 text-xs">{u.email}</td>
                            <td className="p-4">
                              <select
                                value={u.role_id}
                                onChange={(e) => handleRoleChange(u.user_id, e.target.value)}
                                className="bg-slate-900 border border-slate-800 rounded-lg px-3 py-1.5 text-purple-300 font-semibold focus:outline-none focus:border-blue-500 text-xs"
                              >
                                <option value={1}>Admin</option>
                                <option value={2}>Staff</option>
                                <option value={3}>Technician</option>
                                <option value={4}>Customer</option>
                              </select>
                            </td>
                            <td className="p-4 text-right">
                              <button
                                onClick={() => setUserDeleteTarget(u)}
                                className="p-1.5 hover:bg-slate-800 rounded-lg text-slate-400 hover:text-rose-400 transition"
                                title="Delete User Account"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </main>

      {/* ==================================================================== */}
      {/* MODALS                                                               */}
      {/* ==================================================================== */}

      {/* CREATE / EDIT EQUIPMENT MODAL */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4">
          <div className="bg-slate-950 border border-slate-800 rounded-2xl w-full max-w-lg overflow-hidden shadow-2xl">
            <div className="p-6 border-b border-slate-800 flex items-center justify-between">
              <h2 className="text-lg font-bold text-white">
                {editingItem ? 'Edit Equipment' : 'Add New Equipment'}
              </h2>
              <button onClick={handleCloseModal} className="p-2 hover:bg-slate-900 rounded-lg text-slate-400 hover:text-white transition">
                <X className="w-5 h-5" />
              </button>
            </div>
            
            <form onSubmit={handleSubmit} className="p-6 space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Model / Name</label>
                <input 
                  type="text" 
                  required 
                  value={formData.equipment_name}
                  onChange={(e) => setFormData({...formData, equipment_name: e.target.value})}
                  placeholder="e.g. Caterpillar Excavator 320"
                  className="w-full bg-slate-900 border border-slate-800 rounded-xl px-4 py-2.5 text-white text-sm focus:outline-none focus:border-blue-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Category</label>
                  <select 
                    value={formData.category_id}
                    onChange={(e) => setFormData({...formData, category_id: e.target.value})}
                    className="w-full bg-slate-900 border border-slate-800 rounded-xl px-4 py-2.5 text-white text-sm focus:outline-none focus:border-blue-500"
                  >
                    {categories.map(cat => (
                      <option key={cat.category_id} value={cat.category_id}>
                        {cat.category_name}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Daily Rate (₱)</label>
                  <input 
                    type="number" 
                    required 
                    step="0.01"
                    value={formData.rental_price}
                    onChange={(e) => setFormData({...formData, rental_price: e.target.value})}
                    placeholder="2500"
                    className="w-full bg-slate-900 border border-slate-800 rounded-xl px-4 py-2.5 text-white text-sm focus:outline-none focus:border-blue-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Status</label>
                  <select 
                    value={formData.equipment_status}
                    onChange={(e) => setFormData({...formData, equipment_status: e.target.value})}
                    className="w-full bg-slate-900 border border-slate-800 rounded-xl px-4 py-2.5 text-white text-sm focus:outline-none focus:border-blue-500"
                  >
                    <option value="Available">Available</option>
                    <option value="Reserved">Reserved</option>
                    <option value="Rented">Rented</option>
                    <option value="Under Maintenance">Under Maintenance</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Condition</label>
                  <select 
                    value={formData.condition_status}
                    onChange={(e) => setFormData({...formData, condition_status: e.target.value})}
                    className="w-full bg-slate-900 border border-slate-800 rounded-xl px-4 py-2.5 text-white text-sm focus:outline-none focus:border-blue-500"
                  >
                    <option value="Excellent">Excellent</option>
                    <option value="Good">Good</option>
                    <option value="Fair">Fair</option>
                    <option value="Needs Repair">Needs Repair</option>
                  </select>
                </div>
              </div>

              <div className="pt-4 flex items-center justify-end gap-3">
                <button 
                  type="button" 
                  onClick={handleCloseModal}
                  className="px-4 py-2 rounded-xl border border-slate-800 text-slate-300 hover:bg-slate-900 transition font-medium text-xs"
                >
                  Cancel
                </button>
                <button 
                  type="submit"
                  className="px-5 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white transition font-medium text-xs shadow-lg shadow-blue-600/20"
                >
                  {editingItem ? 'Save Changes' : 'Create Item'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* STAFF COUNTER ACTIVATION MODAL */}
      {activateTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4">
          <div className="bg-slate-950 border border-slate-800 rounded-2xl w-full max-w-md p-6 space-y-6 shadow-2xl">
            <div>
              <h3 className="text-lg font-bold text-white flex items-center gap-2">
                <CheckCircle2 className="w-5 h-5 text-purple-400" />
                Activate Reservation at Counter
              </h3>
              <p className="text-slate-400 text-xs mt-1 leading-relaxed">
                Customer has arrived at the store counter. Set the rental duration in days to complete the physical handover for Reservation <span className="text-white font-mono font-semibold">#{activateTarget.rental_id}</span>.
              </p>
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Rental Duration (Days)</label>
              <input 
                type="number"
                min="1"
                value={activationDays}
                onChange={(e) => setActivationDays(e.target.value)}
                className="w-full bg-slate-900 border border-slate-800 rounded-xl px-4 py-2.5 text-white text-sm focus:outline-none focus:border-blue-500"
              />
            </div>
            <div className="flex items-center justify-end gap-3">
              <button 
                type="button" 
                onClick={() => setActivateTarget(null)}
                className="px-4 py-2 rounded-xl border border-slate-800 text-slate-300 hover:bg-slate-900 transition font-medium text-xs"
              >
                Cancel
              </button>
              <button 
                type="button"
                onClick={confirmActivation}
                className="px-5 py-2 rounded-xl bg-purple-600 hover:bg-purple-500 text-white transition font-medium text-xs shadow-lg shadow-purple-600/20"
              >
                Confirm & Check Out
              </button>
            </div>
          </div>
        </div>
      )}

      {/* CUSTOMER CANCELLATION MODAL */}
      {cancelTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4">
          <div className="bg-slate-950 border border-slate-800 rounded-2xl w-full max-w-md p-6 space-y-6 shadow-2xl">
            <h3 className="text-lg font-bold text-white flex items-center gap-2">
              <Ban className="w-5 h-5 text-rose-400" />
              Cancel Reservation Hold
            </h3>
            <p className="text-slate-400 text-xs leading-relaxed">
              Are you sure you want to cancel Reservation <span className="text-white font-mono font-semibold">#{cancelTarget.rental_id}</span>? This will release the hold and make the equipment available to other customers immediately.
            </p>
            <div className="flex items-center justify-end gap-3">
              <button 
                type="button" 
                onClick={() => setCancelTarget(null)}
                className="px-4 py-2 rounded-xl border border-slate-800 text-slate-300 hover:bg-slate-900 transition font-medium text-xs"
              >
                Close
              </button>
              <button 
                type="button"
                onClick={confirmCancellation}
                className="px-5 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-white transition font-medium text-xs shadow-lg shadow-rose-600/20"
              >
                Confirm Cancellation
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODERN RETURN CONFIRMATION MODAL */}
      {returnTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4">
          <div className="bg-slate-950 border border-slate-800 rounded-2xl w-full max-w-md overflow-hidden shadow-2xl p-6 space-y-6">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-full bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400 shrink-0">
                <CheckCircle2 className="w-6 h-6" />
              </div>
              <div>
                <h3 className="text-lg font-bold text-white">Process Return</h3>
                <p className="text-slate-400 text-xs mt-1 leading-relaxed">
                  Mark Rental <span className="text-white font-semibold font-mono">#{returnTarget.rental_id}</span> as returned? This will update the contract and mark equipment back to <span className="text-emerald-400 font-semibold">Available</span>.
                </p>
              </div>
            </div>

            <div className="flex items-center justify-end gap-3">
              <button 
                type="button" 
                onClick={() => setReturnTarget(null)}
                className="px-4 py-2 rounded-xl border border-slate-800 text-slate-300 hover:bg-slate-900 transition font-medium text-xs"
              >
                Cancel
              </button>
              <button 
                type="button"
                onClick={confirmReturn}
                className="px-5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white transition font-medium text-xs shadow-lg shadow-emerald-600/20"
              >
                Confirm Return
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MAINTENANCE COMPLETE CONFIRMATION MODAL */}
      {maintenanceCompleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4">
          <div className="bg-slate-950 border border-slate-800 rounded-2xl w-full max-w-md overflow-hidden shadow-2xl p-6 space-y-6">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-full bg-blue-500/10 border border-blue-500/20 flex items-center justify-center text-blue-400 shrink-0">
                <CheckCircle2 className="w-6 h-6" />
              </div>
              <div>
                <h3 className="text-lg font-bold text-white">Complete Maintenance</h3>
                <p className="text-slate-400 text-xs mt-1 leading-relaxed">
                  Mark Maintenance <span className="text-white font-semibold font-mono">#{maintenanceCompleteTarget.maintenance_id}</span> as completed? The equipment will be marked as repaired and available for rent.
                </p>
              </div>
            </div>

            <div className="flex items-center justify-end gap-3">
              <button 
                type="button" 
                onClick={() => setMaintenanceCompleteTarget(null)}
                className="px-4 py-2 rounded-xl border border-slate-800 text-slate-300 hover:bg-slate-900 transition font-medium text-xs"
              >
                Cancel
              </button>
              <button 
                type="button"
                onClick={confirmMaintenanceComplete}
                className="px-5 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white transition font-medium text-xs shadow-lg shadow-blue-600/20"
              >
                Confirm Complete
              </button>
            </div>
          </div>
        </div>
      )}

      {/* DELETE EQUIPMENT CONFIRMATION MODAL */}
      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4">
          <div className="bg-slate-950 border border-slate-800 rounded-2xl w-full max-w-md overflow-hidden shadow-2xl p-6 space-y-6">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-full bg-rose-500/10 border border-rose-500/20 flex items-center justify-center text-rose-400 shrink-0">
                <AlertTriangle className="w-6 h-6" />
              </div>
              <div>
                <h3 className="text-lg font-bold text-white">Delete Equipment</h3>
                <p className="text-slate-400 text-xs mt-1 leading-relaxed">
                  Are you sure you want to delete <span className="text-white font-semibold">{deleteTarget.equipment_name}</span>? This action cannot be undone.
                </p>
              </div>
            </div>

            <div className="flex items-center justify-end gap-3">
              <button 
                type="button" 
                onClick={() => setDeleteTarget(null)}
                className="px-4 py-2 rounded-xl border border-slate-800 text-slate-300 hover:bg-slate-900 transition font-medium text-xs"
              >
                Cancel
              </button>
              <button 
                type="button"
                onClick={confirmDelete}
                className="px-5 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-white transition font-medium text-xs shadow-lg shadow-rose-600/20"
              >
                Delete Item
              </button>
            </div>
          </div>
        </div>
      )}

      {/* USER DELETE CONFIRMATION MODAL */}
      {userDeleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4">
          <div className="bg-slate-950 border border-slate-800 rounded-2xl w-full max-w-md overflow-hidden shadow-2xl p-6 space-y-6">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-full bg-rose-500/10 border border-rose-500/20 flex items-center justify-center text-rose-400 shrink-0">
                <AlertTriangle className="w-6 h-6" />
              </div>
              <div>
                <h3 className="text-lg font-bold text-white">Delete User Account</h3>
                <p className="text-slate-400 text-xs mt-1 leading-relaxed">
                  Are you sure you want to delete <span className="text-white font-semibold">{userDeleteTarget.first_name} {userDeleteTarget.last_name}</span>? This will permanently remove their access.
                </p>
              </div>
            </div>

            <div className="flex items-center justify-end gap-3">
              <button 
                type="button" 
                onClick={() => setUserDeleteTarget(null)}
                className="px-4 py-2 rounded-xl border border-slate-800 text-slate-300 hover:bg-slate-900 transition font-medium text-xs"
              >
                Cancel
              </button>
              <button 
                type="button"
                onClick={confirmUserDelete}
                className="px-5 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-white transition font-medium text-xs shadow-lg shadow-rose-600/20"
              >
                Delete Account
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ERROR NOTICE MODAL */}
      {errorMessage && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4">
          <div className="bg-slate-950 border border-slate-800 rounded-2xl w-full max-w-md overflow-hidden shadow-2xl p-6 space-y-6">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-full bg-rose-500/10 border border-rose-500/20 flex items-center justify-center text-rose-400 shrink-0">
                <AlertTriangle className="w-6 h-6" />
              </div>
              <div>
                <h3 className="text-lg font-bold text-white">Notice</h3>
                <p className="text-slate-400 text-xs mt-1 leading-relaxed">
                  {errorMessage}
                </p>
              </div>
            </div>

            <div className="flex items-center justify-end">
              <button 
                type="button"
                onClick={() => setErrorMessage(null)}
                className="px-5 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white transition font-medium text-xs shadow-lg shadow-blue-600/20"
              >
                Got it
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
