-- ============================================================
-- RentMart — Rental Status & Space Images Feature Migration
-- Database: rm
-- Compatible with: MySQLyog / MySQL 5.7 / MySQL 8.x
-- ============================================================
-- IMPORTANT: This is a non-destructive migration.
-- It updates the ENUM definitions and image column.
-- ============================================================

-- 1. Add 'reserved' to spaces.status ENUM and convert image column to VARCHAR
ALTER TABLE spaces 
  MODIFY COLUMN status ENUM('available','reserved','rented','maintenance') DEFAULT 'available',
  MODIFY COLUMN image VARCHAR(255);

-- 2. Add 'cancelled' and 'completed' to rentals.status ENUM
ALTER TABLE rentals 
  MODIFY COLUMN status ENUM('active','terminated','expired','pending','cancelled','completed') DEFAULT 'active';

-- 3. Set high-quality stall image assets for default market spaces
UPDATE spaces SET image = 'stall_wet.png' WHERE space_number IN ('BLK-101', 'BLK-102');
UPDATE spaces SET image = 'stall_retail.png' WHERE space_number IN ('BLK-103', 'BLK-104');
UPDATE spaces SET image = 'stall_food.png' WHERE space_number IN ('BLK-105', 'BLK-106');
UPDATE spaces SET image = 'stall_grocery.png' WHERE space_number = 'BLK-107';
UPDATE spaces SET image = 'stall_retail.png' WHERE space_number = 'BLK-108';

-- ============================================================
-- Verification: Run these in MySQLyog to confirm the changes
-- ============================================================
-- SHOW COLUMNS FROM spaces LIKE 'status';
-- SHOW COLUMNS FROM rentals LIKE 'status';
-- SELECT id, space_number, location, image, status FROM spaces;
