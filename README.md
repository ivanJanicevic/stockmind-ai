# StockMind AI

**Multi-Agent AI Platform for Retail & Hospitality**

StockMind AI is a multi-agent AI platform built with the Mozaik framework and Google Gemini. Its goal is to explore how autonomous AI agents can help retail and hospitality businesses improve inventory management, analyze sales, reduce waste, and support business decisions.

## Current Implementation

The initial prototype includes:

- **Analyst Agent** – analyzes business problems and generates recommendations.
- **Reviewer Agent** – independently evaluates the same request and provides another perspective.
- **Monitoring Agent** – observes and logs agent responses and runtime events.
- **Mozaik Runtime** – manages participants, events, and agent execution.
- **Google Gemini** – powers AI inference.

Currently, Analyst and Reviewer process the same input independently. Agent-to-agent collaboration and additional business workflows are planned for future development.

## Tech Stack

- Node.js
- TypeScript
- Mozaik AI (`@mozaik-ai/core`)
- Google Gemini API
- dotenv
- tsx
- npm

## Prerequisites

Before running the application, make sure you have:

- Node.js (Node.js 24 is the version used during development)
- npm
- A Google Gemini API key

You can obtain a Gemini API key from [Google AI Studio](https://aistudio.google.com/apikey).

## Installation

Clone the repository:

```bash
git clone https://github.com/ivanJanicevic/stockmind-ai.git
```

Navigate to the project directory:

```bash
cd stockmind-ai
```

Install dependencies:

```bash
npm install
```

## Environment Configuration

Create a `.env` file in the project root:

```bash
touch .env
```

Add your Gemini API key:

```env
GEMINI_API_KEY=your_gemini_api_key
```

Never commit your `.env` file or expose your API key.

## Running Locally

Start the development server:

```bash
npm run dev
```

The application initializes the Mozaik runtime, joins the Analyst, Reviewer, Monitoring, and User participants, and sends an initial business analysis request.

You should see the runtime initialization messages and agent responses in the terminal.

## Available Scripts

```bash
npm run dev      # Run the application in development mode
npm run build    # Compile TypeScript
npm start        # Run the compiled application
```

## Project Structure

```text
stockmind-ai/
├── src/
│   └── index.ts
├── .env
├── .gitignore
├── package.json
├── package-lock.json
├── tsconfig.json
└── README.md
```

## Planned Features

- Agent-to-agent communication and collaboration.
- Manager Agent for combining recommendations.
- Inventory and stock-level analysis.
- Sales and demand forecasting.
- Expiration-date monitoring.
- Food waste reduction recommendations.
- Business intelligence dashboard.
- Real-time agent execution monitoring.

## Hackathon Project

Built as part of the JigJoy Hackathon, exploring multi-agent AI systems and practical business automation.

**Status:** Initial prototype / Active development.

