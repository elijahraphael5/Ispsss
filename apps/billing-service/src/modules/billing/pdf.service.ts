import { Injectable } from '@nestjs/common';
import * as PDFDocument from 'pdfkit';

const ORANGE = '#F15925';
const DARK = '#0F172A';
const GREY = '#64748B';
const LIGHT = '#F8FAFC';
const BORDER = '#E2E8F0';

interface PdfLine {
  description: string;
  amountKobo: number;
  quantity?: number | null;
}

interface PdfInvoiceData {
  invoiceNumber: string;
  status: string;
  type: string;
  issuedAt?: Date | null;
  dueAt?: Date | null;
  paidAt?: Date | null;
  subtotalKobo: number;
  vatKobo: number;
  discountKobo: number;
  amountKobo: number;
  notes?: string | null;
  lines: PdfLine[];
  customerName: string;
  customerEmail?: string | null;
  customerPhone?: string | null;
  customerAddress?: string | null;
}

interface PdfQuotationData {
  quotationNumber: string;
  status: string;
  validUntil?: Date | null;
  subtotalKobo: number;
  vatKobo: number;
  discountKobo: number;
  totalKobo: number;
  notes?: string | null;
  items: { description: string; quantity: number; unitPriceKobo: number; amountKobo: number }[];
  customerName: string;
  customerEmail?: string | null;
  customerPhone?: string | null;
  customerAddress?: string | null;
}

function naira(kobo: number): string {
  return 'NGN ' + (kobo / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtDate(d?: Date | null): string {
  return d ? new Date(d).toLocaleDateString('en-GB') : '—';
}

function fmtLines(lines: PdfLine[]): Array<{ description: string; qty: string; amount: string }> {
  return (lines ?? []).map((l) => ({
    description: l.description ?? '',
    qty: l.quantity != null && l.quantity > 1 ? String(l.quantity) : '1',
    amount: naira(l.amountKobo),
  }));
}

@Injectable()
export class PdfService {
  async invoicePdf(data: PdfInvoiceData): Promise<{ invoiceNumber: string; buffer: Buffer }> {
    const doc = new PDFDocument({ size: 'A4', margin: 48 });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    const done = new Promise<Buffer>((resolve) => doc.on('end', () => resolve(Buffer.concat(chunks))));

    this.header(doc, 'INVOICE', data.invoiceNumber, data.status);

    this.metaTable(doc, [
      ['Invoice Number', data.invoiceNumber],
      ['Invoice Type', data.type],
      ['Issued', fmtDate(data.issuedAt)],
      ['Due Date', fmtDate(data.dueAt)],
      ['Paid', fmtDate(data.paidAt)],
    ]);

    this.billTo(doc, data.customerName, data.customerEmail, data.customerPhone, data.customerAddress);

    this.itemsTable(doc, [
      ['Description', 'Qty', 'Amount'],
      ...fmtLines(data.lines).map((l) => [l.description, l.qty, l.amount] as string[]),
    ]);

    this.totals(doc, [
      ['Subtotal', naira(data.subtotalKobo)],
      ['VAT (7.5%)', naira(data.vatKobo)],
      ['Discount', naira(data.discountKobo)],
      ['Total Due', naira(data.amountKobo)],
    ]);

    if (data.notes) {
      this.noteBox(doc, 'Notes', data.notes);
    }

    this.paymentDetails(doc);

    this.footer(doc);
    doc.end();
    return { invoiceNumber: data.invoiceNumber, buffer: await done };
  }

  async quotationPdf(data: PdfQuotationData): Promise<{ quotationNumber: string; buffer: Buffer }> {
    const doc = new PDFDocument({ size: 'A4', margin: 48 });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    const done = new Promise<Buffer>((resolve) => doc.on('end', () => resolve(Buffer.concat(chunks))));

    this.header(doc, 'QUOTATION', data.quotationNumber, data.status);

    this.metaTable(doc, [
      ['Quotation Number', data.quotationNumber],
      ['Valid Until', fmtDate(data.validUntil)],
      ['Status', data.status],
    ]);

    this.billTo(doc, data.customerName, data.customerEmail, data.customerPhone, data.customerAddress);

    this.itemsTable(doc, [
      ['Description', 'Qty', 'Unit Price', 'Amount'],
      ...data.items.map((i) => [i.description, String(i.quantity), naira(i.unitPriceKobo), naira(i.amountKobo)] as string[]),
    ]);

    this.totals(doc, [
      ['Subtotal', naira(data.subtotalKobo)],
      ['VAT (7.5%)', naira(data.vatKobo)],
      ['Discount', naira(data.discountKobo)],
      ['Total', naira(data.totalKobo)],
    ]);

    if (data.notes) {
      this.noteBox(doc, 'Notes', data.notes);
    }

    this.footer(doc);
    doc.end();
    return { quotationNumber: data.quotationNumber, buffer: await done };
  }

  private header(doc: PDFKit.PDFDocument, title: string, number: string, status: string): void {
    doc.rect(0, 0, doc.page.width, 72).fill(ORANGE);
    doc
      .fillColor('#FFFFFF')
      .font('Helvetica-Bold')
      .fontSize(22)
      .text('Hikonnect', 48, 20)
      .fontSize(10)
      .font('Helvetica')
      .text('High-Speed Internet', 48, 46);

    doc.font('Helvetica-Bold').fontSize(18).fillColor(DARK).text(title, 340, 20, { width: 220, align: 'right' });
    doc
      .font('Helvetica')
      .fontSize(9)
      .fillColor(GREY)
      .text(number, 340, 44, { width: 220, align: 'right' });

    const statusText = String(status ?? '');
    doc
      .font('Helvetica-Bold')
      .fontSize(9)
      .fillColor(statusText === 'PAID' ? '#16A34A' : ORANGE)
      .text(statusText, 340, 58, { width: 220, align: 'right' });

    doc.moveDown(1.5);
  }

  private metaTable(doc: PDFKit.PDFDocument, rows: Array<[string, string]>): void {
    let y = doc.y;
    doc.roundedRect(48, y, doc.page.width - 96, rows.length * 18 + 16, 6).fillAndStroke(LIGHT, BORDER);
    doc.fillColor(DARK).font('Helvetica-Bold').fontSize(9);
    rows.forEach(([label, value], i) => {
      const rowY = y + 10 + i * 18;
      doc.fillColor(GREY).text(label.toUpperCase(), 60, rowY, { width: 130 });
      doc.fillColor(DARK).text(value, 200, rowY, { width: doc.page.width - 260, align: 'right' });
    });
    doc.y = y + rows.length * 18 + 24;
    doc.moveDown(0.5);
  }

  private billTo(
    doc: PDFKit.PDFDocument,
    name: string,
    email?: string | null,
    phone?: string | null,
    address?: string | null,
  ): void {
    doc.font('Helvetica-Bold').fontSize(11).fillColor(DARK).text('BILL TO', 48, doc.y);
    doc.moveDown(0.4);
    doc.font('Helvetica-Bold').fontSize(10).fillColor(DARK).text(name || '—');
    doc.font('Helvetica').fontSize(9).fillColor(GREY);
    if (email) doc.text(email);
    if (phone) doc.text(phone);
    if (address) doc.text(address, { width: doc.page.width - 96 });
    doc.moveDown(0.8);
  }

  private itemsTable(doc: PDFKit.PDFDocument, rows: string[][]): void {
    const startY = doc.y;
    const widths = rows[0].length === 4 ? [doc.page.width - 96 - 160, 36, 68, 92] : [doc.page.width - 96 - 96, 36, 60];
    const colXs = [48];
    for (let i = 0; i < widths.length - 1; i++) {
      colXs.push(colXs[i] + widths[i]);
    }
    const cellH = 26;

    doc.fillColor(DARK).rect(48, startY, doc.page.width - 96, cellH).fill();
    doc.font('Helvetica-Bold').fontSize(9).fillColor('#FFFFFF');
    rows[0].forEach((h, i) => doc.text(h.toUpperCase(), colXs[i] + 6, startY + 8, { width: widths[i] - 6 }));
    doc.y = startY + cellH;

    rows.slice(1).forEach((row, ri) => {
      const y = startY + cellH + ri * cellH;
      if (ri % 2 === 0) {
        doc.fillColor('#FFFFFF').rect(48, y, doc.page.width - 96, cellH).fill();
      }
      doc.font('Helvetica').fontSize(9);
      row.forEach((cell, i) => {
        doc.fillColor(DARK).text(cell, colXs[i] + 6, y + 8, { width: widths[i] - 6 });
      });
      doc.y = y + cellH;
    });

    doc.moveDown(0.5);
  }

  private totals(doc: PDFKit.PDFDocument, rows: Array<[string, string]>): void {
    const boxW = 220;
    const x = doc.page.width - 48 - boxW;
    let y = doc.y;
    doc.roundedRect(x, y, boxW, rows.length * 20 + 16, 6).fillAndStroke(LIGHT, BORDER);
    rows.forEach(([label, value], i) => {
      const rowY = y + 10 + i * 20;
      const isTotal = i === rows.length - 1;
      doc
        .font(isTotal ? 'Helvetica-Bold' : 'Helvetica')
        .fontSize(9)
        .fillColor(isTotal ? DARK : GREY)
        .text(label, x + 12, rowY, { width: 90 });
      doc
        .font('Helvetica-Bold')
        .fontSize(isTotal ? 10 : 9)
        .fillColor(isTotal ? ORANGE : DARK)
        .text(value, x + 12 + 90, rowY, { width: boxW - 102, align: 'right' });
    });
    doc.y = y + rows.length * 20 + 24;
    doc.moveDown(0.5);
  }

  private paymentDetails(doc: PDFKit.PDFDocument): void {
    doc.moveDown(0.5);
    const y = doc.y;
    const rows: Array<[string, string]> = [
      ['PROVIDUS BANK', '1305547038'],
      ['FIRST BANK', '2042504920'],
      ['ACCOUNTS NAME', 'Hi-Konnect Network Limited'],
    ];
    const boxH = rows.length * 18 + 44;
    doc.roundedRect(48, y, doc.page.width - 96, boxH, 6).fillAndStroke(LIGHT, BORDER);
    doc.font('Helvetica-Bold').fontSize(9).fillColor(DARK).text('PAYMENT DETAILS', 60, y + 10, { width: 200 });
    rows.forEach(([label, value], i) => {
      const rowY = y + 30 + i * 18;
      doc.fillColor(GREY).font('Helvetica-Bold').fontSize(9).text(label, 60, rowY, { width: 130 });
      doc.fillColor(DARK).font('Helvetica').fontSize(9).text(value, 200, rowY, { width: doc.page.width - 260, align: 'right' });
    });
    doc.y = y + boxH + 10;
  }

  private noteBox(doc: PDFKit.PDFDocument, label: string, note: string): void {
    doc.moveDown(0.5);
    const y = doc.y;
    doc.roundedRect(48, y, doc.page.width - 96, 56, 6).fillAndStroke(LIGHT, BORDER);
    doc.font('Helvetica-Bold').fontSize(9).fillColor(DARK).text(label.toUpperCase(), 60, y + 10, { width: 100 });
    doc.font('Helvetica').fontSize(9).fillColor(GREY).text(note, 60, y + 26, { width: doc.page.width - 132 });
    doc.y = y + 64;
  }

  private footer(doc: PDFKit.PDFDocument): void {
    const pages = doc.bufferedPageRange();
    for (let i = pages.start; i < pages.start + pages.count; i++) {
      doc.switchToPage(i);
      const h = doc.page.height;
      doc
        .font('Helvetica')
        .fontSize(8)
        .fillColor(GREY)
        .text(
          'Generated by Hikonnect — thank you for choosing us. Payments can be made via the customer portal.',
          48,
          h - 40,
          { width: doc.page.width - 96, align: 'center' },
        );
      doc.text(`Page ${i + 1} of ${pages.count}`, 48, h - 24, { width: doc.page.width - 96, align: 'center' });
    }
  }
}
