#!/bin/bash

# StellarSwipe Users API Test Script
# Run this after starting the server with: npm run start:dev

BASE_URL="http://localhost:3000"
API_URL="${BASE_URL}/users"

# Test wallet address (valid Stellar format)
WALLET_ADDRESS="GBPXX4SCQWXQF7S6QLPINMQXTQ62KBZZQZJ4KQKZJQKFGZQKQKZQKQK7"

echo "🧪 Testing StellarSwipe Users API"
echo "=================================="
echo ""

# Test 1: Health Check
echo "1️⃣  Testing Health Endpoint..."
curl -s "${BASE_URL}/health" | jq '.' || echo "❌ Health check failed"
echo ""

# Test 2: Create User
echo "2️⃣  Testing Create User (POST /users)..."
CREATE_RESPONSE=$(curl -s -X POST "${API_URL}" \
  -H "Content-Type: application/json" \
  -d "{
    \"walletAddress\": \"${WALLET_ADDRESS}\",
    \"email\": \"test@stellarswipe.com\",
    \"displayName\": \"Test User\"
  }")
echo "$CREATE_RESPONSE" | jq '.'
echo ""

# Test 3: Get User by Wallet Address
echo "3️⃣  Testing Get User by Wallet (GET /users/wallet/:address)..."
curl -s "${API_URL}/wallet/${WALLET_ADDRESS}" | jq '.'
echo ""

# Test 4: Get User Preferences
echo "4️⃣  Testing Get User Preferences..."
curl -s "${API_URL}/wallet/${WALLET_ADDRESS}/preferences" | jq '.'
echo ""

# Test 5: Update Preferences
echo "5️⃣  Testing Update Preferences (PATCH /users/wallet/:address/preferences)..."
curl -s -X PATCH "${API_URL}/wallet/${WALLET_ADDRESS}/preferences" \
  -H "Content-Type: application/json" \
  -d '{
    "riskLevel": "HIGH",
    "language": "es",
    "defaultSlippagePercent": 2.5,
    "tradeNotifications": false
  }' | jq '.'
echo ""

# Test 6: Verify Updated Preferences
echo "6️⃣  Testing Verify Updated Preferences..."
curl -s "${API_URL}/wallet/${WALLET_ADDRESS}/preferences" | jq '.'
echo ""

# Test 7: Connect Wallet (Reconnection Test)
echo "7️⃣  Testing Wallet Reconnection (POST /users/connect)..."
curl -s -X POST "${API_URL}/connect" \
  -H "Content-Type: application/json" \
  -d "{\"walletAddress\": \"${WALLET_ADDRESS}\"}" | jq '.'
echo ""

# Test 8: Invalid Wallet Address Format
echo "8️⃣  Testing Invalid Wallet Address Validation..."
curl -s -X POST "${API_URL}" \
  -H "Content-Type: application/json" \
  -d '{
    "walletAddress": "INVALID_ADDRESS_FORMAT"
  }' | jq '.'
echo ""

# Test 9: Soft Delete User
echo "9️⃣  Testing Soft Delete (DELETE /users/wallet/:address)..."
curl -s -X DELETE "${API_URL}/wallet/${WALLET_ADDRESS}" -w "\nStatus Code: %{http_code}\n"
echo ""

echo "✅ API Tests Complete!"
echo ""
echo "📝 To run these tests:"
echo "   1. Start server: npm run start:dev"
echo "   2. Run script: chmod +x test-api.sh && ./test-api.sh"
