-- ============================================
-- ORBIT OWNER SETUP SCRIPT
-- ============================================
-- This script sets up owner permissions for orbitdev00@gmail.com
-- Run this in your Supabase SQL Editor at:
-- https://supabase.com/dashboard/project/eiujcdmvpqhxewcczcqw/sql
-- ============================================

-- First, let's see what's currently in the database
SELECT
  au.id::text as user_id,
  au.email as auth_email,
  ur.email as rep_email,
  ur.username,
  ur.role,
  ur.tier,
  ur.subscription_expires_at
FROM auth.users au
LEFT JOIN user_reputation ur ON au.id::text = ur.user_id
WHERE au.email = 'orbitdev00@gmail.com';

-- Step 1: Update or insert your owner record
INSERT INTO user_reputation (
  user_id,
  email,
  username,
  role,
  tier,
  created_at,
  updated_at
)
SELECT
  id::text,
  'orbitdev00@gmail.com',
  'Orbit_Dev',
  'owner',
  'omega',
  NOW(),
  NOW()
FROM auth.users
WHERE email = 'orbitdev00@gmail.com'
ON CONFLICT (user_id)
DO UPDATE SET
  username = 'Orbit_Dev',
  role = 'owner',
  tier = 'omega',
  email = 'orbitdev00@gmail.com',
  updated_at = NOW();

-- Step 2: Verify the update
SELECT
  ur.user_id,
  ur.email,
  ur.username,
  ur.role,
  ur.tier,
  au.email as auth_email
FROM user_reputation ur
LEFT JOIN auth.users au ON ur.user_id = au.id::text
WHERE ur.email = 'orbitdev00@gmail.com' OR au.email = 'orbitdev00@gmail.com';
