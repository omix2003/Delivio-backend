import PDFDocument from 'pdfkit';
import fs from 'fs';
import path from 'path';
import bwipjs from 'bwip-js';

interface OrderPDFData {
  orderId: string;
  partnerName: string;
  customerName: string;
  customerPhone: string;
  customerEmail?: string;
  customerAddress: string;
  productType?: string;
  pickupAddress: string;
  dropAddress: string;
  orderAmount?: number;
  paymentType?: 'PREPAID' | 'COD';
  priority?: string;
  estimatedDuration?: number;
  distanceKm?: number;
  createdAt: Date;
  barcode?: string; // Optional barcode value
}

export const pdfService = {
  /**
   * Generate shipping label PDF (compact format for pasting on packages)
   * Size: 4x6 inches (standard shipping label size)
   */
  async generateShippingLabel(orderData: OrderPDFData): Promise<string> {
    // Create uploads/pdf directory if it doesn't exist
    const pdfDir = path.join(process.cwd(), 'uploads', 'pdfs');
    if (!fs.existsSync(pdfDir)) {
      fs.mkdirSync(pdfDir, { recursive: true });
    }

    const filename = `label-${orderData.orderId}-${Date.now()}.pdf`;
    const filepath = path.join(pdfDir, filename);

    // Generate barcode buffer if barcode is provided
    let barcodeBuffer: Buffer | null = null;
    if (orderData.barcode) {
      try {
        barcodeBuffer = await bwipjs.toBuffer({
          bcid: 'code128', // Barcode type
          text: orderData.barcode,
          scale: 2,
          height: 40,
          includetext: true,
          textxalign: 'center',
        });
      } catch (barcodeError: any) {
        console.warn('[PDF Service] Barcode generation failed:', barcodeError.message);
        // Continue without barcode if generation fails
      }
    }

    return new Promise((resolve, reject) => {
      // 4x6 inches = 288x432 points (72 points per inch)
      const doc = new PDFDocument({ 
        margin: 20, 
        size: [288, 432] // 4x6 inches
      });

      // Pipe PDF to file
      const stream = fs.createWriteStream(filepath);
      doc.pipe(stream);

      // Border for label
      doc.rect(10, 10, 268, 412).stroke();

      // Calculate layout: left content area and right barcode area
      const leftContentWidth = barcodeBuffer ? 140 : 248; // Reduce width if barcode exists
      const barcodeX = 160; // Start position for barcode on right side
      const barcodeWidth = 108; // Width available for barcode

      let yPos = 25;

      // Header - Order ID (large and bold)
      doc.fontSize(18).font('Helvetica-Bold').fillColor('black');
      doc.text('ORDER #', 20, yPos, { width: leftContentWidth, align: 'left' });
      yPos += 20;
      doc.fontSize(24).text(orderData.orderId.substring(0, 8).toUpperCase(), 20, yPos, { width: leftContentWidth, align: 'left' });
      yPos += 25;
      
      // Date
      doc.fontSize(8).font('Helvetica').fillColor('gray');
      doc.text(`Date: ${orderData.createdAt.toLocaleDateString()}`, 20, yPos, { width: leftContentWidth, align: 'left' });
      yPos += 20;
      doc.fillColor('black');

      // Place barcode on the right side (if available)
      if (barcodeBuffer && orderData.barcode) {
        // Place barcode on the right side, starting near the top
        const barcodeY = 30;
        doc.image(barcodeBuffer, barcodeX, barcodeY, { 
          width: barcodeWidth,
          height: 60,
          align: 'center'
        });

        // Add barcode text below the barcode
        doc.fontSize(7).font('Helvetica').fillColor('black');
        doc.text(orderData.barcode, barcodeX, barcodeY + 60, { 
          width: barcodeWidth, 
          align: 'center' 
        });
      }

      // Delivery Address Section (most important for shipping label)
      doc.fontSize(12).font('Helvetica-Bold').text('DELIVER TO:', 20, yPos, { width: leftContentWidth });
      yPos += 15;
      doc.fontSize(10).font('Helvetica-Bold');
      doc.text(orderData.customerName, 20, yPos, { width: leftContentWidth });
      yPos += 15;
      doc.fontSize(9).font('Helvetica');
      const textOptions = { width: leftContentWidth, lineGap: 2 };
      const addressHeight = doc.heightOfString(orderData.customerAddress, textOptions);
      doc.text(orderData.customerAddress, 20, yPos, textOptions);
      yPos += addressHeight + 10;
      doc.fontSize(8);
      doc.text(`Phone: ${orderData.customerPhone}`, 20, yPos, { width: leftContentWidth });
      yPos += 12;
      if (orderData.customerEmail) {
        doc.text(`Email: ${orderData.customerEmail}`, 20, yPos, { width: leftContentWidth });
        yPos += 12;
      }

      // Separator line
      yPos += 5;
      doc.moveTo(20, yPos).lineTo(268, yPos).stroke();
      yPos += 10;

      // Order Details (compact)
      doc.fontSize(8).font('Helvetica');
      if (orderData.productType) {
        doc.text(`Product: ${orderData.productType.charAt(0).toUpperCase() + orderData.productType.slice(1).replace(/_/g, ' ')}`, 20, yPos, { width: leftContentWidth });
        yPos += 12;
      }
      doc.text(`Priority: ${orderData.priority || 'NORMAL'}`, 20, yPos, { width: leftContentWidth });
      yPos += 12;
      if (orderData.orderAmount) {
        doc.text(`Amount: ₹${orderData.orderAmount.toFixed(2)}`, 20, yPos, { width: leftContentWidth });
        yPos += 12;
      }
      if (orderData.paymentType) {
        const paymentText = orderData.paymentType === 'COD' ? 'COD - Collect on Delivery' : 'Prepaid';
        doc.fontSize(8).font('Helvetica-Bold');
        if (orderData.paymentType === 'COD') {
          doc.fillColor('red');
        } else {
          doc.fillColor('green');
        }
        doc.text(`Payment: ${paymentText}`, 20, yPos, { width: leftContentWidth });
        yPos += 12;
        if (orderData.paymentType === 'COD' && orderData.orderAmount) {
          doc.fontSize(9).font('Helvetica-Bold').fillColor('red');
          doc.text(`⚠️ COLLECT ₹${orderData.orderAmount.toFixed(2)}`, 20, yPos, { width: leftContentWidth });
          yPos += 14;
        }
        doc.fillColor('black'); // Reset to black
        doc.fontSize(8).font('Helvetica'); // Reset font
      }

      // Separator line
      yPos += 5;
      doc.moveTo(20, yPos).lineTo(268, yPos).stroke();
      yPos += 10;

      // Pickup Address (smaller, at bottom)
      doc.fontSize(7).font('Helvetica').fillColor('gray');
      doc.text('FROM:', 20, yPos, { width: leftContentWidth });
      yPos += 10;
      doc.fontSize(8).fillColor('black');
      const pickupText = orderData.pickupAddress.length > 50 
        ? orderData.pickupAddress.substring(0, 50) + '...'
        : orderData.pickupAddress;
      doc.text(pickupText, 20, yPos, { width: leftContentWidth, lineGap: 1 });

      // Partner name at bottom
      doc.fontSize(7).font('Helvetica').fillColor('gray');
      doc.text(`Partner: ${orderData.partnerName}`, 20, 400, { width: leftContentWidth, align: 'left' });

      // Finalize PDF
      doc.end();

      stream.on('finish', () => {
        // Return relative path from uploads directory
        resolve(`/uploads/pdfs/${filename}`);
      });

      stream.on('error', (error) => {
        reject(error);
      });
    });
  },

  /**
   * Generate order details PDF (full document format)
   */
  async generateOrderPDF(orderData: OrderPDFData): Promise<string> {
    // Create uploads/pdf directory if it doesn't exist
    const pdfDir = path.join(process.cwd(), 'uploads', 'pdfs');
    if (!fs.existsSync(pdfDir)) {
      fs.mkdirSync(pdfDir, { recursive: true });
    }

    const filename = `order-${orderData.orderId}-${Date.now()}.pdf`;
    const filepath = path.join(pdfDir, filename);

    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({ margin: 50, size: 'A4' });

      // Pipe PDF to file
      const stream = fs.createWriteStream(filepath);
      doc.pipe(stream);

      // Header
      doc.fontSize(20).font('Helvetica-Bold').text('ORDER DETAILS', { align: 'center' });
      doc.moveDown();

      // Order ID
      doc.fontSize(14).font('Helvetica-Bold').text(`Order ID: ${orderData.orderId}`, { align: 'center' });
      doc.moveDown(0.5);

      // Date
      doc.fontSize(10).font('Helvetica').text(`Date: ${orderData.createdAt.toLocaleDateString()} ${orderData.createdAt.toLocaleTimeString()}`, { align: 'center' });
      doc.moveDown(2);

      // Customer Information Section
      doc.fontSize(16).font('Helvetica-Bold').text('CUSTOMER INFORMATION', { underline: true });
      doc.moveDown(0.5);
      doc.fontSize(11).font('Helvetica');
      doc.text(`Name: ${orderData.customerName}`);
      doc.text(`Phone: ${orderData.customerPhone}`);
      if (orderData.customerEmail) {
        doc.text(`Email: ${orderData.customerEmail}`);
      }
      doc.text(`Address: ${orderData.customerAddress}`);
      doc.moveDown(1.5);

      // Order Information Section
      doc.fontSize(16).font('Helvetica-Bold').text('ORDER INFORMATION', { underline: true });
      doc.moveDown(0.5);
      doc.fontSize(11).font('Helvetica');
      if (orderData.productType) {
        doc.text(`Product Type: ${orderData.productType.charAt(0).toUpperCase() + orderData.productType.slice(1).replace(/_/g, ' ')}`);
      }
      doc.text(`Priority: ${orderData.priority || 'NORMAL'}`);
      if (orderData.orderAmount) {
        doc.text(`Order Amount: ₹${orderData.orderAmount.toFixed(2)}`);
      }
      if (orderData.paymentType) {
        const paymentText = orderData.paymentType === 'COD' ? 'Cash on Delivery (COD)' : 'Prepaid';
        const paymentColor = orderData.paymentType === 'COD' ? 'red' : 'green';
        doc.fillColor(paymentColor);
        doc.text(`Payment Type: ${paymentText}`);
        if (orderData.paymentType === 'COD' && orderData.orderAmount) {
          doc.text(`⚠️ COLLECT ₹${orderData.orderAmount.toFixed(2)} FROM CUSTOMER ON DELIVERY`, { underline: true });
        }
        doc.fillColor('black'); // Reset to black
      }
      doc.moveDown(1.5);

      // Delivery Information Section
      doc.fontSize(16).font('Helvetica-Bold').text('DELIVERY INFORMATION', { underline: true });
      doc.moveDown(0.5);
      doc.fontSize(11).font('Helvetica');
      doc.text(`Pickup Address: ${orderData.pickupAddress}`);
      doc.text(`Delivery Address: ${orderData.dropAddress}`);
      if (orderData.distanceKm) {
        doc.text(`Distance: ${orderData.distanceKm.toFixed(2)} km`);
      }
      if (orderData.estimatedDuration) {
        doc.text(`Estimated Duration: ${orderData.estimatedDuration} minutes`);
      }
      doc.moveDown(1.5);

      // Partner Information
      doc.fontSize(16).font('Helvetica-Bold').text('PARTNER INFORMATION', { underline: true });
      doc.moveDown(0.5);
      doc.fontSize(11).font('Helvetica');
      doc.text(`Partner: ${orderData.partnerName}`);
      doc.moveDown(2);

      // Footer
      doc.fontSize(9).font('Helvetica').fillColor('gray').text('This is an automatically generated order document.', { align: 'center' });

      // Finalize PDF
      doc.end();

      stream.on('finish', () => {
        // Return relative path from uploads directory
        resolve(`/uploads/pdfs/${filename}`);
      });

      stream.on('error', (error) => {
        reject(error);
      });
    });
  },
};







