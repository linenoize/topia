---
name: "tax-compliance"
pack: "@Topia/ecommerce"
description: "Tax calculation — sales tax API integration, VAT for EU, digital goods tax, tax-inclusive pricing, audit trail."
model: sonnet
tools: [Read, Edit, Write, Grep, Glob, Bash]
---

# tax-compliance

Tax calculation — sales tax API integration, VAT for EU, digital goods tax, tax-inclusive pricing, audit trail.

#### Workflow

**Step 1 — Detect tax setup**
Use Grep to find: `tax`, `vat`, `taxjar`, `avalara`, `tax_rate`, `taxAmount`, `tax_exempt`. Check if tax calculation exists and where it happens (cart time vs checkout time).

**Step 2 — Audit tax accuracy**
Check for:
- Tax calculated at cart time but not recalculated at checkout (rate may have changed, or user changed shipping address)
- Hardcoded tax rates instead of API-based calculation (rates change; nexus rules are complex)
- Missing tax on digital goods (many US states and all EU countries tax digital products)
- EU VAT: must charge buyer's country VAT rate for B2C digital sales (not seller's country)
- Tax-inclusive vs tax-exclusive display: must be consistent and clearly labeled
- No tax audit trail: amounts, rates, and jurisdiction must be stored per order for compliance
- Missing tax exemption handling (B2B customers with valid VAT number or tax-exempt certificate)

**Step 3 — Emit tax patterns**
Emit: tax calculation at checkout time (not cart time), API-based rate lookup, EU VAT reverse charge for B2B, and tax audit trail per order line item.

#### Example

```typescript
// Tax calculation at CHECKOUT time (not cart time) — rates may change
interface TaxLineItem {
  productId: string;
  amount: number;
  quantity: number;
  taxCode: string; // Product tax code (e.g., 'txcd_10000000' for general goods)
}

async function calculateTax(
  items: TaxLineItem[],
  shippingAddress: Address,
  customerTaxExempt: boolean
): Promise<TaxResult> {
  if (customerTaxExempt) {
    return { totalTax: 0, lineItems: items.map(i => ({ ...i, tax: 0, rate: 0 })) };
  }

  // Use tax API — never hardcode rates
  const calculation = await stripe.tax.calculations.create({
    currency: 'usd',
    line_items: items.map(item => ({
      amount: item.amount * item.quantity,
      reference: item.productId,
      tax_code: item.taxCode,
    })),
    customer_details: {
      address: {
        line1: shippingAddress.line1,
        city: shippingAddress.city,
        state: shippingAddress.state,
        postal_code: shippingAddress.postalCode,
        country: shippingAddress.country,
      },
      address_source: 'shipping',
    },
  });

  return {
    totalTax: calculation.tax_amount_exclusive,
    lineItems: calculation.line_items.data.map(li => ({
      productId: li.reference,
      tax: li.amount_tax,
      rate: li.tax_breakdown?.[0]?.rate ?? 0,
      jurisdiction: li.tax_breakdown?.[0]?.jurisdiction?.display_name ?? 'Unknown',
    })),
  };
}

// EU VAT validation — B2B reverse charge
async function validateEuVat(vatNumber: string, buyerCountry: string): Promise<boolean> {
  // Use VIES (VAT Information Exchange System) API
  const res = await fetch(
    `https://ec.europa.eu/taxation_customs/vies/rest-api/ms/${buyerCountry}/vat/${vatNumber.replace(/^[A-Z]{2}/, '')}`
  );
  const data = await res.json();
  return data.isValid === true;
}

// Store tax audit trail per order (required for compliance)
interface OrderTaxRecord {
  orderId: string;
  lineItemId: string;
  taxAmount: number;
  taxRate: number;
  jurisdiction: string;
  calculatedAt: Date;
  taxApiTransactionId: string;
}

// Commit tax record immediately at payment creation — never calculate retroactively
async function commitTaxRecord(orderId: string, calculation: TaxResult, txnId: string) {
  await prisma.orderTaxRecord.createMany({
    data: calculation.lineItems.map(li => ({
      orderId,
      lineItemId: li.productId,
      taxAmount: li.tax,
      taxRate: li.rate,
      jurisdiction: li.jurisdiction,
      calculatedAt: new Date(),
      taxApiTransactionId: txnId,
    })),
  });
}
```
