# Authentication API - Postman Documentation

**Base URL:** `http://localhost:3000/api/v1`

## Environment Variables

Create a Postman environment with these variables:

| Variable | Initial Value | Description |
|----------|---------------|-------------|
| `baseUrl` | `http://localhost:3000/api/v1` | API base URL |
| `accessToken` | | JWT access token (auto-set after login) |
| `refreshToken` | | Refresh token (auto-set after login) |
| `resetToken` | | Password reset token (auto-set after verify-code) |
| `userEmail` | `test@example.com` | Test user email |
| `userPassword` | `Password123!` | Test user password |

---

## 1. Register User

**Method:** `POST`  
**URL:** `{{baseUrl}}/auth/register`  
**Headers:**
```
Content-Type: application/json
```

**Request Body:**
```json
{
  "name": "John Doe",
  "email": "john@example.com",
  "password": "Password123!"
}
```

**Response (201):**
```json
{
  "success": true,
  "message": "Registration successful, please check your email for verification",
  "data": {
    "user": {
      "id": "64f1a2b3c4d5e6f7a8b9c0d1",
      "name": "John Doe",
      "email": "john@example.com",
      "role": "cashier"
    }
  }
}
```

**Postman Tests:**
```javascript
pm.test("Status code is 201", function () {
    pm.response.to.have.status(201);
});

pm.test("Response has success field", function () {
    var jsonData = pm.response.json();
    pm.expect(jsonData.success).to.be.true;
});

pm.test("Response has user data", function () {
    var jsonData = pm.response.json();
    pm.expect(jsonData.data.user).to.have.property('id');
    pm.expect(jsonData.data.user).to.have.property('email');
});
```

---

## 2. Login User

**Method:** `POST`  
**URL:** `{{baseUrl}}/auth/login`  
**Headers:**
```
Content-Type: application/json
x-platform: mobile
```

**Request Body:**
```json
{
  "email": "john@example.com",
  "password": "Password123!"
}
```

**Response (200):**
```json
{
  "success": true,
  "message": "Login successful",
  "data": {
    "user": {
      "id": "64f1a2b3c4d5e6f7a8b9c0d1",
      "name": "John Doe",
      "email": "john@example.com",
      "role": "cashier"
    },
    "accessToken": "eyJhbGciOiJIUzI1NiIs...",
    "refreshToken": "a1b2c3d4e5f6..."
  }
}
```

**Postman Tests:**
```javascript
pm.test("Status code is 200", function () {
    pm.response.to.have.status(200);
});

pm.test("Login successful", function () {
    var jsonData = pm.response.json();
    pm.expect(jsonData.success).to.be.true;
    pm.expect(jsonData.message).to.eql("Login successful");
});

pm.test("Access token is stored", function () {
    var jsonData = pm.response.json();
    if (jsonData.data.accessToken) {
        pm.environment.set("accessToken", jsonData.data.accessToken);
    }
});

pm.test("Refresh token is stored", function () {
    var jsonData = pm.response.json();
    if (jsonData.data.refreshToken) {
        pm.environment.set("refreshToken", jsonData.data.refreshToken);
    }
});
```

---

## 3. Refresh Token

**Method:** `POST`  
**URL:** `{{baseUrl}}/auth/refresh`  
**Headers:**
```
Content-Type: application/json
```

**Request Body (Mobile):**
```json
{
  "refreshToken": "{{refreshToken}}"
}
```

**Response (200):**
```json
{
  "success": true,
  "message": "Token refreshed successfully",
  "data": {
    "accessToken": "eyJhbGciOiJIUzI1NiIs...",
    "refreshToken": "newRefreshToken123..."
  }
}
```

**Postman Tests:**
```javascript
pm.test("Status code is 200", function () {
    pm.response.to.have.status(200);
});

pm.test("New tokens are stored", function () {
    var jsonData = pm.response.json();
    if (jsonData.data.accessToken) {
        pm.environment.set("accessToken", jsonData.data.accessToken);
    }
    if (jsonData.data.refreshToken) {
        pm.environment.set("refreshToken", jsonData.data.refreshToken);
    }
});
```

---

## 4. Logout

**Method:** `POST`  
**URL:** `{{baseUrl}}/auth/logout`  
**Headers:**
```
Content-Type: application/json
```

**Request Body (Mobile):**
```json
{
  "refreshToken": "{{refreshToken}}"
}
```

**Response (200):**
```json
{
  "success": true,
  "message": "Logout successful",
  "data": null
}
```

**Postman Tests:**
```javascript
pm.test("Status code is 200", function () {
    pm.response.to.have.status(200);
});

pm.test("Logout successful", function () {
    var jsonData = pm.response.json();
    pm.expect(jsonData.success).to.be.true;
});
```

---

## 5. Get Current User

**Method:** `GET`  
**URL:** `{{baseUrl}}/auth/me`  
**Headers:**
```
Authorization: Bearer {{accessToken}}
```

**Response (200):**
```json
{
  "success": true,
  "message": "User data retrieved successfully",
  "data": {
    "_id": "64f1a2b3c4d5e6f7a8b9c0d1",
    "name": "John Doe",
    "email": "john@example.com",
    "role": "cashier",
    "isEmailVerified": true,
    "createdAt": "2024-01-15T10:30:00.000Z"
  }
}
```

**Postman Tests:**
```javascript
pm.test("Status code is 200", function () {
    pm.response.to.have.status(200);
});

pm.test("User data is returned", function () {
    var jsonData = pm.response.json();
    pm.expect(jsonData.data).to.have.property('email');
    pm.expect(jsonData.data).to.have.property('name');
});
```

---

## 6. Change Password

**Method:** `PATCH`  
**URL:** `{{baseUrl}}/auth/change-password`  
**Headers:**
```
Content-Type: application/json
Authorization: Bearer {{accessToken}}
```

**Request Body:**
```json
{
  "oldPassword": "Password123!",
  "newPassword": "NewPassword456!"
}
```

**Response (200):**
```json
{
  "success": true,
  "message": "Password changed successfully, please log in again on other devices",
  "data": null
}
```

**Postman Tests:**
```javascript
pm.test("Status code is 200", function () {
    pm.response.to.have.status(200);
});

pm.test("Password changed", function () {
    var jsonData = pm.response.json();
    pm.expect(jsonData.success).to.be.true;
});
```

---

## 7. Send Verification Email

**Method:** `POST`  
**URL:** `{{baseUrl}}/auth/verify-email/send`  
**Headers:**
```
Content-Type: application/json
```

**Request Body:**
```json
{
  "email": "john@example.com"
}
```

**Response (200):**
```json
{
  "success": true,
  "message": "Verification code has been sent to your email",
  "data": null
}
```

**Postman Tests:**
```javascript
pm.test("Status code is 200", function () {
    pm.response.to.have.status(200);
});

pm.test("Email sent confirmation", function () {
    var jsonData = pm.response.json();
    pm.expect(jsonData.success).to.be.true;
});
```

---

## 8. Confirm Email Verification

**Method:** `POST`  
**URL:** `{{baseUrl}}/auth/verify-email/confirm`  
**Headers:**
```
Content-Type: application/json
```

**Request Body:**
```json
{
  "email": "john@example.com",
  "code": "123456"
}
```

**Response (200):**
```json
{
  "success": true,
  "message": "Email verified successfully",
  "data": null
}
```

**Postman Tests:**
```javascript
pm.test("Status code is 200", function () {
    pm.response.to.have.status(200);
});

pm.test("Email verified", function () {
    var jsonData = pm.response.json();
    pm.expect(jsonData.success).to.be.true;
});
```

---

## 9. Forgot Password

**Method:** `POST`  
**URL:** `{{baseUrl}}/auth/forgot-password`  
**Headers:**
```
Content-Type: application/json
```

**Request Body:**
```json
{
  "email": "john@example.com"
}
```

**Response (200):**
```json
{
  "success": true,
  "message": "If the email is registered, a reset code has been sent",
  "data": null
}
```

**Postman Tests:**
```javascript
pm.test("Status code is 200", function () {
    pm.response.to.have.status(200);
});

pm.test("Reset email sent", function () {
    var jsonData = pm.response.json();
    pm.expect(jsonData.success).to.be.true;
});
```

---

## 10. Verify Reset Code

**Method:** `POST`  
**URL:** `{{baseUrl}}/auth/forgot-password/verify-code`  
**Headers:**
```
Content-Type: application/json
```

**Request Body:**
```json
{
  "email": "john@example.com",
  "code": "123456"
}
```

**Response (200):**
```json
{
  "success": true,
  "message": "Code verified",
  "data": {
    "resetToken": "eyJhbGciOiJIUzI1NiIs..."
  }
}
```

**Postman Tests:**
```javascript
pm.test("Status code is 200", function () {
    pm.response.to.have.status(200);
});

pm.test("Reset token is stored", function () {
    var jsonData = pm.response.json();
    if (jsonData.data.resetToken) {
        pm.environment.set("resetToken", jsonData.data.resetToken);
    }
});
```

---

## 11. Reset Password

**Method:** `POST`  
**URL:** `{{baseUrl}}/auth/reset-password`  
**Headers:**
```
Content-Type: application/json
```

**Request Body:**
```json
{
  "resetToken": "{{resetToken}}",
  "newPassword": "NewPassword789!"
}
```

**Response (200):**
```json
{
  "success": true,
  "message": "Password reset successfully, please log in again",
  "data": null
}
```

**Postman Tests:**
```javascript
pm.test("Status code is 200", function () {
    pm.response.to.have.status(200);
});

pm.test("Password reset successful", function () {
    var jsonData = pm.response.json();
    pm.expect(jsonData.success).to.be.true;
});
```

---

## Error Responses

### 400 - Validation Error
```json
{
  "success": false,
  "message": "Validation error",
  "code": "VALIDATION_ERROR",
  "details": [
    {
      "field": "email",
      "message": "Invalid email format"
    }
  ]
}
```

### 401 - Invalid Credentials
```json
{
  "success": false,
  "message": "Invalid email or password",
  "code": "INVALID_CREDENTIALS"
}
```

### 401 - Email Not Verified
```json
{
  "success": false,
  "message": "Please verify your email before logging in",
  "code": "EMAIL_NOT_VERIFIED"
}
```

### 409 - Email Already Registered
```json
{
  "success": false,
  "message": "Email is already registered",
  "code": "EMAIL_ALREADY_REGISTERED"
}
```

### 429 - Rate Limited
```json
{
  "success": false,
  "message": "Too many requests, please try again later",
  "code": "RATE_LIMITED"
}
```

---

## Testing Workflow

1. **Register a new user** → Store email
2. **Send verification email** → Get OTP from email/console
3. **Confirm email verification** → Use OTP code
4. **Login** → Store accessToken and refreshToken
5. **Get current user** → Verify authentication works
6. **Refresh token** → Get new tokens
7. **Change password** → Test password update
8. **Logout** → Clear tokens

---

## Postman Collection Variables

Auto-set variables from login response:

```javascript
// In Tests tab of Login request
var jsonData = pm.response.json();
if (jsonData.data.accessToken) {
    pm.environment.set("accessToken", jsonData.data.accessToken);
}
if (jsonData.data.refreshToken) {
    pm.environment.set("refreshToken", jsonData.data.refreshToken);
}
```
