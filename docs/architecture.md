# Investly architecture and diagram mapping

This document records how the supplied diagrams map to the working application. It does not claim to describe object or deployment diagrams; neither was supplied.

## Activity flow: user, system, database

```mermaid
flowchart LR
  subgraph User
    A[Open Investly] --> B[Register or sign in]
    B --> C[Choose a calculator, comparison, history, or currency tool]
    C --> D[Enter investment details]
    D --> E[Review results and assumptions]
    E --> F[Save calculation]
    E --> G[Generate PDF or Excel report]
    E --> H[Convert currency]
    F --> I[Review or delete history]
    B --> J[Sign out]
  end
  subgraph System
    K[Validate credentials] --> L[Display private dashboard]
    M[Validate calculator inputs] --> N[Calculate using versioned formula]
    N --> O[Return result and graph data]
    P[Generate report file]
    Q[Resolve rate using source and validity dates]
  end
  subgraph Database
    R[(Users and sessions)]
    S[(Calculation snapshots)]
    T[(Report references and files)]
    U[(Exchange rates)]
    V[(Audit activity)]
  end
  B --> K
  K <--> R
  D --> M
  M --> N
  F --> S
  G --> P --> T
  H --> Q <--> U
  J --> R
  F --> V
```

Invalid credentials and invalid calculator input return clear errors; no history snapshot is stored until the user explicitly saves the result. The application uses ownership checks at every history/report read and delete route.

## Sequence diagram: authentication, calculation, report

```mermaid
sequenceDiagram
  actor User
  participant UI as Website / UI
  participant Account as Account service
  participant DB as SQLite database
  participant Calc as Calculator service
  participant Report as Report generator
  User->>UI: Enter login details
  UI->>Account: POST /api/login
  Account->>DB: Look up email and password hash
  DB-->>Account: Account record
  Account-->>UI: HTTP-only session cookie
  UI-->>User: Dashboard
  User->>UI: Select tool and submit inputs
  UI->>Calc: POST /api/calculate
  Calc->>Calc: Validate and calculate
  Calc-->>UI: Results, assumptions, graph values
  UI-->>User: Display projection
  User->>UI: Save calculation
  UI->>DB: Store input/output/formula snapshot
  DB-->>UI: Calculation ID
  User->>UI: Request report
  UI->>Report: POST /api/history/:id/report
  Report->>DB: Read owned snapshot and store file reference
  DB-->>Report: Report ID
  Report-->>UI: Download URL
```

The logout route invalidates the server-side session and clears the cookie. The report request in this implementation generates a PDF or XLSX file synchronously, then stores the file and reference in one database transaction.

## Use-case diagram: User and Admin

```mermaid
flowchart LR
  User([User])
  Admin([Admin])
  subgraph Investly
    register[Register / sign in]
    dashboard[View dashboard]
    calculators[Use seven calculators]
    compare[Compare plans]
    currency[Convert currencies]
    history[View / save / delete history]
    reports[Download PDF / Excel reports]
    profile[Update profile]
    logout[Sign out]
    users[Manage user accounts]
    modules[Manage supported calculator modules]
    rates[Manage sourced exchange rates]
    activity[View reports and system activity]
  end
  User --- register
  User --- dashboard
  User --- calculators
  User --- compare
  User --- currency
  User --- history
  User --- reports
  User --- profile
  User --- logout
  Admin --- register
  Admin --- dashboard
  Admin --- users
  Admin --- modules
  Admin --- rates
  Admin --- activity
  Admin --- logout
```

Admin operations are role-protected on the server. The browser only hides the Admin navigation for non-admin accounts; that is not the authorization boundary.

## Domain responsibilities

```mermaid
classDiagram
  class Account {
    +accountId
    +name
    +email
    +passwordHash
    +login()
    +logout()
    +updateProfile()
  }
  class User {
    +preferredCurrency
    +createdAt
    +viewDashboard()
    +viewHistory()
    +downloadReport()
  }
  class Admin {
    +role
    +manageUsers()
    +manageModules()
    +updateExchangeRates()
    +viewReports()
  }
  class CalculatorType {
    +type
    +name
    +description
  }
  class InvestmentCalculator {
    +validateInput()
    +calculate()
    +generateGraphData()
  }
  class CalculatorModule {
    +calculate()
  }
  class CalculationResult {
    +principal
    +interest
    +totalValue
    +currency
    +summary()
    +graphData()
  }
  class CalculationHistory {
    +date
    +details
    +save()
    +retrieve()
  }
  class CurrencyManager {
    +supportedCurrencies()
    +selectCurrency()
    +formatCurrency()
  }
  class ExchangeRateService {
    +rate
    +source
    +effectiveAt
    +validUntil
  }
  class CurrencyConverter {
    +fromCurrency
    +toCurrency
    +convertAmount()
  }
  class ComparisonManager {
    +plans
    +comparePlans()
    +getBestOption()
  }
  class ReportGenerator {
    +format
    +includeGraph
    +generatePDF()
    +generateExcel()
  }
  Account <|-- User
  Account <|-- Admin
  User --> CalculationHistory
  User --> InvestmentCalculator
  InvestmentCalculator --> CalculatorType
  InvestmentCalculator --> CalculatorModule
  InvestmentCalculator --> CalculationResult
  InvestmentCalculator --> CurrencyManager
  CurrencyManager --> CurrencyConverter
  CurrencyManager --> ExchangeRateService
  InvestmentCalculator --> ComparisonManager
  ComparisonManager --> ReportGenerator
  ReportGenerator --> CalculationHistory
```

### Persistence mapping

| UML concept | Implementation |
| --- | --- |
| Account, User, Admin | `users` table (`role` distinguishes user/admin), `sessions` table, scrypt password hashes |
| Calculator Type | `calculator_types` registry; module availability and display metadata are stored here |
| InvestmentCalculator and calculator subclasses | `src/calculators.js` shared validation/formula service and seven typed formula branches |
| CalculationResult and CalculationHistory | `calculations` table stores immutable JSON inputs, outputs, assumptions, formula version, and currency |
| ComparisonManager | `compare()` service and normalized `comparisons` / `comparison_plans` tables |
| CurrencyManager, CurrencyConverter, ExchangeRateService | currency API helpers and `exchange_rates` table with rate source/effective/expiry timestamps |
| ReportGenerator | `src/reports.js`; `reports` stores the generated file, format, graph flag, owner, and calculation reference |
| Admin system activity | `system_activity` audit table |

The module registry is metadata, while the formula engine is a closed set of supported calculators. Admins can change names/descriptions/categories and enable or disable a supported module; they cannot create a new formula engine from the admin UI.
