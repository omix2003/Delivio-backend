# 🚚 Delivio - Centralized Delivery Network

**A comprehensive delivery management platform connecting partners, agents, and administrators**

[![Next.js](https://img.shields.io/badge/Next.js-16.0-black?style=for-the-badge&logo=next.js)](https://nextjs.org/)
[![Express](https://img.shields.io/badge/Express-4.18-green?style=for-the-badge&logo=express)](https://expressjs.com/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-blue?style=for-the-badge&logo=typescript)](https://www.typescriptlang.org/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-Latest-blue?style=for-the-badge&logo=postgresql)](https://www.postgresql.org/)
[![Prisma](https://img.shields.io/badge/Prisma-6.1-2D3748?style=for-the-badge&logo=prisma)](https://www.prisma.io/)

[Features](#-features) • [Installation](#-installation) • [Documentation](#-documentation) • [API Reference](#-api-documentation) • [Deployment](#-deployment)

---

## 📋 Table of Contents

- [Overview](#-overview)
- [Features](#-features)
- [Tech Stack](#-tech-stack)
- [Project Structure](#-project-structure)
- [Prerequisites](#-prerequisites)
- [Quick Start](#-quick-start)
- [Installation](#-installation)
- [Configuration](#-configuration)
- [Running the Application](#-running-the-application)
- [API Documentation](#-api-documentation)
- [Deployment](#-deployment)
- [Development](#-development)
- [Recent Updates](#-recent-updates)
- [Contributing](#-contributing)
- [License](#-license)

## 🎯 Overview

Delivio is a full-stack delivery management platform that enables seamless coordination between delivery partners, agents, and administrators. The platform provides real-time tracking, order management, analytics, and comprehensive administrative tools with a modern, professional design.

### Key Capabilities

- 🔄 **Real-time Order Management** - Live order tracking and status updates
- 📍 **Location Tracking** - Real-time agent location monitoring
- 🔌 **REST API Integration** - Partner API for seamless integrations
- 📊 **Analytics Dashboard** - Comprehensive metrics and insights
- 🔐 **Multi-role Authentication** - Secure role-based access control with email verification
- 📧 **Email Service** - OTP verification and welcome emails
- 📱 **Mobile-Optimized** - Responsive design for all devices
- 🎨 **Modern UI** - Professional color palette and design system

## ✨ Features

### 👥 For Partners

- ✅ REST API for order creation and management
- ✅ Webhook support for real-time order updates
- ✅ Comprehensive dashboard with analytics
- ✅ API key management and rotation
- ✅ Order tracking and status monitoring
- ✅ Performance metrics and reporting
- ✅ Company profile management
- ✅ Category-based organization (Quick Commerce, E-commerce, Food Delivery, etc.)

### 🚴 For Agents

- ✅ Real-time order notifications
- ✅ Accept/reject order offers
- ✅ Live location tracking
- ✅ Order status updates (Pickup, Delivery, etc.)
- ✅ Profile and document management
- ✅ KYC verification system
- ✅ Earnings and performance tracking
- ✅ Mobile-optimized interface with collapsible sidebar
- ✅ Email verification with OTP

### 👨‍💼 For Administrators

- ✅ Live map view of all agents and orders
- ✅ Agent approval and management
- ✅ Partner account management
- ✅ Order oversight and reassignment
- ✅ KYC document verification
- ✅ System-wide analytics dashboard
- ✅ Support ticket management
- ✅ Real-time system monitoring
- ✅ Contact form submissions management

### 🌐 Public Features

- ✅ Landing page with company showcase
- ✅ Contact form with email notifications
- ✅ About page with team information
- ✅ Order tracking (public)
- ✅ Responsive design for all devices

## 🛠️ Tech Stack

### Backend

| Technology | Purpose |
|------------|---------|
| **Node.js 18+** | Runtime environment |
| **Express.js** | Web framework |
| **TypeScript** | Type-safe development |
| **PostgreSQL** | Primary database |
| **Prisma** | ORM and database toolkit |
| **Redis** | Caching and real-time data |
| **Socket.io** | WebSocket for real-time updates |
| **JWT** | Authentication |
| **Multer** | File upload handling |
| **Nodemailer** | Email service (OTP, welcome emails) |
| **Firebase Admin** | Push notifications |

### Frontend

| Technology | Purpose |
|------------|---------|
| **Next.js 16** | React framework with App Router |
| **TypeScript** | Type-safe development |
| **Tailwind CSS 4** | Utility-first CSS framework |
| **Axios** | HTTP client |
| **Socket.io Client** | WebSocket client |
| **Mapbox GL** | Interactive maps |
| **Recharts** | Data visualization |
| **NextAuth.js** | Authentication |
| **Zod** | Schema validation |
| **Framer Motion** | Animations |
| **Lucide React** | Icon library |

## 📁 Project Structure

```
NextJS/
├── backend/                    # Express.js API Server
│   ├── src/
│   │   ├── controllers/        # Request handlers
│   │   ├── routes/            # API route definitions
│   │   ├── services/          # Business logic layer
│   │   │   ├── mail.service.ts      # Email service (OTP, welcome)
│   │   │   ├── email-verification.service.ts  # OTP verification
│   │   │   └── ...
│   │   ├── middleware/        # Auth, validation, error handling
│   │   ├── lib/               # External library configs
│   │   │   ├── prisma.ts      # Prisma client
│   │   │   ├── redis.ts       # Redis client
│   │   │   ├── websocket.ts   # Socket.io server
│   │   │   └── webhook.ts     # Webhook utilities
│   │   └── utils/             # Utility functions
│   ├── prisma/
│   │   ├── schema.prisma      # Database schema
│   │   └── migrations/        # Database migrations
│   └── uploads/               # File uploads directory
│
├── next-app/                  # Next.js Frontend Application
│   ├── app/                   # Next.js App Router
│   │   ├── (admin)/          # Admin route group
│   │   ├── (agent)/          # Agent route group
│   │   ├── (partner)/        # Partner route group
│   │   ├── (auth)/           # Authentication routes
│   │   ├── contact/          # Contact page
│   │   ├── about/            # About page
│   │   └── page.tsx          # Landing page
│   ├── components/            # React components
│   │   ├── layout/           # Layout components
│   │   ├── maps/             # Map components
│   │   ├── orders/           # Order components
│   │   └── ui/               # Reusable UI components
│   │       ├── logo-carousel.tsx    # Partner logo carousel
│   │       └── gradient-heading.tsx # Gradient heading component
│   ├── lib/                   # Utilities and helpers
│   │   ├── api/              # API client functions
│   │   └── utils/            # Helper functions
│   └── public/                # Static assets
│       └── logo.png          # Application logo
│
└── docs/                      # Project documentation
    ├── API_DOCUMENTATION.md
    ├── DEPLOYMENT.md
    ├── PARTNER_INTEGRATION_GUIDE.md
    └── ...
```

## 📦 Prerequisites

Before you begin, ensure you have the following installed:

- **Node.js** 18+ ([Download](https://nodejs.org/))
- **npm** or **yarn** package manager
- **PostgreSQL** 12+ ([Download](https://www.postgresql.org/download/))
- **Redis** (Optional, for caching and real-time features)
- **Git** ([Download](https://git-scm.com/))

### Additional Services

- **Mapbox Account** - For map features ([Sign up](https://www.mapbox.com/))
- **Firebase Project** - For push notifications (Optional)
- **SMTP Server** - For email service (Gmail, SendGrid, etc.)

## 🚀 Quick Start

```bash
# Clone the repository
git clone <repository-url>
cd NextJS

# Backend setup
cd backend
npm install
cp .env.example .env
# Edit .env with your configuration
npm run prisma:generate
npm run prisma:migrate
npm run dev

# Frontend setup (in a new terminal)
cd ../next-app
npm install
cp .env.local.example .env.local
# Edit .env.local with your configuration
npm run dev
```

Visit `http://localhost:3000` to see the application.

## 📥 Installation

### Step 1: Clone Repository

```bash
git clone <repository-url>
cd NextJS
```

### Step 2: Backend Setup

```bash
cd backend

# Install dependencies
npm install

# Set up environment variables
cp .env.example .env
# Edit .env with your configuration

# Set up database
npm run prisma:generate
npm run prisma:migrate

# (Optional) Seed database
npm run prisma:seed
```

### Step 3: Frontend Setup

```bash
cd ../next-app

# Install dependencies
npm install

# Set up environment variables
cp .env.local.example .env.local
# Edit .env.local with your configuration
```

## ⚙️ Configuration

### Backend Environment Variables

Create `backend/.env`:

```env
# Server Configuration
NODE_ENV=development
PORT=5000

# Database
DATABASE_URL="postgresql://user:password@localhost:5432/delivery_network"

# Authentication
JWT_SECRET="your-super-secret-jwt-key-minimum-32-characters-long"

# CORS
CORS_ORIGIN="http://localhost:3000"

# Frontend URL (for email links)
FRONTEND_URL="http://localhost:3000"

# Email Service (SMTP)
SMTP_HOST="smtp.gmail.com"
SMTP_PORT="587"
SMTP_USER="your-email@gmail.com"
SMTP_PASSWORD="your-app-password"
SMTP_FROM="your-email@gmail.com"

# Contact Form
CONTACT_EMAIL="admin@delivio.com"

# Redis (Optional)
REDIS_ENABLED=true
REDIS_URL="redis://localhost:6379"

# Firebase (Optional)
FIREBASE_PROJECT_ID="your-project-id"
FIREBASE_PRIVATE_KEY="your-private-key"
FIREBASE_CLIENT_EMAIL="your-client-email"
```

### Frontend Environment Variables

Create `next-app/.env.local`:

```env
# API Configuration
NEXT_PUBLIC_API_URL="http://localhost:5000/api"

# Authentication
NEXTAUTH_URL="http://localhost:3000"
NEXTAUTH_SECRET="your-nextauth-secret-minimum-32-characters"

# Maps
NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN="pk.your-mapbox-token"
```

### Generate Secure Secrets

```bash
# Generate JWT_SECRET
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

# Generate NEXTAUTH_SECRET
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

## 🏃 Running the Application

### Development Mode

**Terminal 1 - Start Backend:**
```bash
cd backend
npm run dev
```
Backend runs on `http://localhost:5000`

**Terminal 2 - Start Frontend:**
```bash
cd next-app
npm run dev
```
Frontend runs on `http://localhost:3000`

### Production Mode

**Build and Start Backend:**
```bash
cd backend
npm run build
npm start
```

**Build and Start Frontend:**
```bash
cd next-app
npm run build
npm start
```

## 📚 API Documentation

### Base URLs

- **Development**: `http://localhost:5000/api`
- **Production**: `https://your-backend-url.onrender.com/api`

### Authentication Methods

#### JWT Authentication (Web App)
```http
Authorization: Bearer <jwt_token>
```

#### API Key Authentication (Partner API)
```http
X-API-Key: pk_<your_api_key>
```

### Quick API Examples

**Register User (with OTP):**
```bash
curl -X POST http://localhost:5000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "name": "John Doe",
    "email": "john@example.com",
    "password": "securePassword123",
    "phone": "+1234567890",
    "role": "AGENT"
  }'
```

**Verify OTP:**
```bash
curl -X POST http://localhost:5000/api/auth/verify-otp \
  -H "Content-Type: application/json" \
  -d '{
    "email": "john@example.com",
    "otp": "123456"
  }'
```

**Resend OTP:**
```bash
curl -X POST http://localhost:5000/api/auth/resend-otp \
  -H "Content-Type: application/json" \
  -d '{
    "email": "john@example.com"
  }'
```

**Create Order (Partner API):**
```bash
curl -X POST http://localhost:5000/api/partner-api/orders \
  -H "X-API-Key: pk_your_api_key" \
  -H "Content-Type: application/json" \
  -d '{
    "pickupLat": 28.7041,
    "pickupLng": 77.1025,
    "dropLat": 28.6139,
    "dropLng": 77.2090,
    "payoutAmount": 150.00,
    "priority": "HIGH"
  }'
```

**Submit Contact Form:**
```bash
curl -X POST http://localhost:5000/api/public/contact \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Jane Doe",
    "email": "jane@example.com",
    "phone": "+1234567890",
    "subject": "Inquiry",
    "message": "I would like to know more about your services."
  }'
```

### Complete API Reference

📖 See [`docs/API_DOCUMENTATION.md`](./docs/API_DOCUMENTATION.md) for complete API documentation.

## 🚢 Deployment

### Quick Deployment Guide

See [`docs/QUICK_DEPLOY.md`](./docs/QUICK_DEPLOY.md) for fast-track deployment.

### Detailed Deployment

See [`docs/DEPLOYMENT.md`](./docs/DEPLOYMENT.md) for comprehensive deployment instructions.

### Deployment Platforms

- **Backend**: [Render.com](https://render.com) (recommended)
- **Frontend**: [Netlify](https://netlify.com) (recommended)
- **Database**: Render PostgreSQL or external PostgreSQL
- **Redis**: Render Redis or external Redis

### Deployment Checklists

- ✅ [Backend Deployment Checklist](./docs/backend-deployment-checklist.md)
- ✅ [Frontend Deployment Checklist](./docs/frontend-deployment-checklist.md)

## 💻 Development

### Available Scripts

#### Backend Scripts

```bash
npm run dev              # Start development server with hot reload
npm run build            # Build for production
npm start                # Start production server
npm run prisma:generate  # Generate Prisma Client
npm run prisma:migrate   # Run database migrations
npm run prisma:studio    # Open Prisma Studio (database GUI)
npm run prisma:seed      # Seed database with sample data
```

#### Frontend Scripts

```bash
npm run dev              # Start development server
npm run build            # Build for production
npm start                # Start production server
npm run lint             # Run ESLint
```

### Code Structure

- **Backend**: MVC pattern with controllers, services, and routes
- **Frontend**: Component-based architecture with Next.js App Router
- **Database**: Prisma ORM with migrations
- **Real-time**: Socket.io for WebSocket connections

### Environment Setup

1. Copy `.env.example` to `.env` in backend
2. Copy `.env.local.example` to `.env.local` in next-app
3. Fill in all required environment variables
4. Run database migrations
5. Start development servers

## 🎨 Design System

### Color Palette

The application uses a professional color palette optimized for delivery and logistics:

| Purpose | Color | Hex |
|---------|-------|-----|
| Primary | Deep Blue | `#1F3C88` |
| Secondary | Operational Green | `#2FBF71` |
| Accent | Amber | `#F4B400` |
| Error | Red | `#E63946` |
| Text (Primary) | Near Black | `#1A1A1A` |
| Text (Secondary) | Gray | `#6B7280` |
| Border | Light Gray | `#E5E7EB` |
| Background | Off White | `#F9FAFB` |

### UI Components

- **Logo Carousel** - Animated partner logo showcase
- **Gradient Heading** - Reusable gradient text components
- **Dock Navigation** - Modern bottom navigation bar
- **Responsive Layouts** - Mobile-first design approach

## 📧 Email Service

The platform includes a comprehensive email service for user communication:

### Features

- ✅ **OTP Verification** - Email-based OTP for user registration
- ✅ **Welcome Emails** - Automated welcome emails after verification
- ✅ **Contact Form** - Email notifications for contact form submissions
- ✅ **Logo Integration** - Branded email templates with embedded logo
- ✅ **Professional Design** - Modern email templates with gradient headers

### Email Templates

1. **OTP Verification Email** - Sent during registration with 6-digit OTP code
2. **Welcome Email** - Sent after successful email verification (role-specific)
3. **Contact Form Email** - Sent to admin when contact form is submitted

### Configuration

Email service uses Nodemailer with SMTP configuration. Supports:
- Gmail (with App Password)
- SendGrid
- Custom SMTP servers

## 🔒 Security

- ✅ **JWT Authentication** - Secure token-based authentication
- ✅ **Email Verification** - OTP-based email verification for all roles (except admin)
- ✅ **API Key Authentication** - For partner integrations
- ✅ **Password Hashing** - bcryptjs with salt rounds
- ✅ **CORS Protection** - Configurable allowed origins
- ✅ **Input Validation** - Zod and Express Validator
- ✅ **File Upload Validation** - Type and size restrictions
- ✅ **Environment Variables** - Sensitive data in .env files
- ✅ **SQL Injection Protection** - Prisma ORM parameterized queries
- ✅ **XSS Protection** - React's built-in XSS protection

## 🗄️ Database

The application uses **PostgreSQL** with **Prisma ORM**.

### Key Models

- **User** - Authentication and user profiles
- **Agent** - Delivery agent profiles and status
- **Partner** - Partner accounts and API keys
- **Order** - Delivery orders and tracking
- **Document** - Agent KYC documents
- **SupportTicket** - Support ticket management
- **EmailVerification** - OTP verification and temporary registration data

### Database Schema

See `backend/prisma/schema.prisma` for the complete schema definition.

### Migrations

```bash
# Create a new migration
npm run prisma:migrate

# Apply migrations in production
npm run prisma:migrate:deploy
```

## 🌐 Real-time Features

- **WebSocket Support** - Real-time order updates via Socket.io
- **Location Tracking** - Real-time agent location updates
- **Order Notifications** - Push notifications for order status changes
- **Live Map** - Real-time map updates for admin dashboard

## 📱 Mobile Support

The frontend is fully responsive with:

- ✅ **Collapsible Sidebar** - Mobile-optimized navigation
- ✅ **Touch-Friendly UI** - Optimized for mobile interactions
- ✅ **Responsive Design** - Works seamlessly on all screen sizes
- ✅ **Progressive Web App** - Can be installed on mobile devices
- ✅ **Dock Navigation** - Modern bottom navigation for mobile

## 📖 Documentation

All documentation is available in the [`docs/`](./docs/) directory:

| Document | Description |
|----------|-------------|
| [API_DOCUMENTATION.md](./docs/API_DOCUMENTATION.md) | Complete API reference |
| [DEPLOYMENT.md](./docs/DEPLOYMENT.md) | Deployment guide |
| [QUICK_DEPLOY.md](./docs/QUICK_DEPLOY.md) | Quick deployment reference |
| [PARTNER_INTEGRATION_GUIDE.md](./docs/PARTNER_INTEGRATION_GUIDE.md) | Partner API integration |
| [backend-deployment-checklist.md](./docs/backend-deployment-checklist.md) | Backend deployment checklist |
| [frontend-deployment-checklist.md](./docs/frontend-deployment-checklist.md) | Frontend deployment checklist |

## 🆕 Recent Updates

### Email Verification System
- ✅ Implemented OTP-based email verification for user registration
- ✅ Added email service with Nodemailer integration
- ✅ Created welcome emails for verified users (Agent, Partner, Logistics Provider)
- ✅ Email templates with branded logo integration

### Contact Page
- ✅ Added public contact page with form
- ✅ Email notifications for contact form submissions
- ✅ Responsive design with proper placeholder visibility

### UI/UX Improvements
- ✅ Updated color palette to professional Deep Blue and Operational Green
- ✅ Added logo carousel component for partner showcase
- ✅ Improved gradient heading components
- ✅ Enhanced mobile navigation with dock navbar
- ✅ Fixed z-index issues and UI overlaps

### Logo Integration
- ✅ Integrated application logo in email templates
- ✅ Added logo to landing page and navigation
- ✅ Partner logo showcase on landing page

## 🤝 Contributing

Contributions are welcome! Please follow these steps:

1. **Fork the repository**
2. **Create a feature branch** (`git checkout -b feature/amazing-feature`)
3. **Make your changes**
4. **Commit your changes** (`git commit -m 'Add some amazing feature'`)
5. **Push to the branch** (`git push origin feature/amazing-feature`)
6. **Open a Pull Request**

### Development Guidelines

- Follow TypeScript best practices
- Write meaningful commit messages
- Add tests for new features
- Update documentation as needed
- Follow the existing code style

## 📝 License

This project is licensed under the ISC License.

## 🆘 Support

Need help? Check out:

- 📚 [Documentation](./docs/)
- 🔌 [API Documentation](./docs/API_DOCUMENTATION.md)
- 🚀 [Deployment Guide](./docs/DEPLOYMENT.md)
- 🔗 [Partner Integration Guide](./docs/PARTNER_INTEGRATION_GUIDE.md)

## 🎯 Roadmap

- [x] Email verification with OTP
- [x] Contact page and form
- [x] Professional color palette
- [x] Logo integration in emails
- [ ] Enhanced analytics and reporting
- [ ] Mobile app (React Native)
- [ ] Advanced route optimization
- [ ] Multi-language support
- [ ] Payment integration
- [ ] SMS notifications
- [ ] Advanced admin features
- [ ] Automated testing suite
- [ ] CI/CD pipeline

## 🙏 Acknowledgments

- [Next.js](https://nextjs.org/) - React framework
- [Express.js](https://expressjs.com/) - Web framework
- [Prisma](https://www.prisma.io/) - Database toolkit
- [Mapbox](https://www.mapbox.com/) - Maps platform
- [Tailwind CSS](https://tailwindcss.com/) - CSS framework
- [Nodemailer](https://nodemailer.com/) - Email service

---

<div align="center">

**Built with ❤️ using Next.js, Express.js, and TypeScript**

[⬆ Back to Top](#-delivio---centralized-delivery-network)

</div>
