-- ====================================================================
-- EquipRent: Initial Seed Data for Testing & Demonstration
-- ====================================================================

BEGIN;

-- 1. SEED ROLES
INSERT INTO roles (role_name, description) VALUES
('Admin', 'System administrator with full access privileges'),
('Staff', 'Frontdesk staff handling rentals and customer interactions'),
('Technician', 'Maintenance personnel handling equipment repairs'),
('Customer', 'Registered client renting equipment')
ON CONFLICT (role_name) DO NOTHING;

-- 2. SEED USERS (Admin, Staff, Technician, and a Customer User)
INSERT INTO users (role_id, first_name, last_name, username, password_hash, email, phone_number, street, barangay, city) VALUES
(1, 'Admin', 'User', 'admin_user', '$2b$10$DummyHashAdmin123456789', 'admin@equiprent.com', '09123456789', '123 Main St', 'San Antonio', 'Pasig City'),
(2, 'Jane', 'Staff', 'staff_jane', '$2b$10$DummyHashStaff123456789', 'jane.staff@equiprent.com', '09187654321', '456 Apple St', 'Oranbo', 'Pasig City'),
(3, 'Mike', 'Technician', 'tech_mike', '$2b$10$DummyHashTech123456789', 'mike.tech@equiprent.com', '09111222333', '789 Pine St', 'Kapitolyo', 'Pasig City'),
(4, 'Juan', 'Dela Cruz', 'customer_juan', '$2b$10$DummyHashCust123456789', 'juan.delacruz@gmail.com', '09998887777', '321 Acacia St', 'Ugong', 'Pasig City')
ON CONFLICT (username) DO NOTHING;

-- 3. SEED CUSTOMERS (Linking user with role_id 4)
INSERT INTO customers (user_id, customer_type) 
SELECT user_id, 'VIP' FROM users WHERE username = 'customer_juan'
ON CONFLICT DO NOTHING;

-- 4. SEED EQUIPMENT CATEGORIES
INSERT INTO equipment_categories (category_name, description) VALUES
('Power Tools', 'Heavy-duty construction and drilling equipment'),
('Audio/Visual', 'Projectors, microphones, and sound systems'),
('Event Equipment', 'Tents, chairs, and generators')
ON CONFLICT (category_name) DO NOTHING;

-- 5. SEED EQUIPMENT ITEMS
INSERT INTO equipment (category_id, equipment_name, description, rental_price, equipment_status, condition_status) VALUES
(1, 'Makita Rotary Hammer Drill', 'Heavy-duty concrete demolition hammer drill', 500.00, 'Available', 'Good'),
(1, 'DeWalt Cordless Circular Saw', '18V brushless circular saw for timber cutting', 350.00, 'Available', 'Good'),
(2, 'Epson Full HD Projector', '3400 lumens bright conference projector', 1200.00, 'Available', 'Good'),
(2, 'JBL Portable PA Sound System', 'Bluetooth enabled wireless microphone PA system', 1500.00, 'Available', 'Good'),
(3, 'Honda Generator 5kVA', 'Gasoline powered portable generator', 2000.00, 'Available', 'Good');

COMMIT;