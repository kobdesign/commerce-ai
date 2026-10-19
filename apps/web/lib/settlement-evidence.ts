import type { PayoutTotalBasis } from '@commerce/contracts';

export const payoutBasisLabel:Record<PayoutTotalBasis,string>={
  reported_total:'ยอดตาม Statement',
  derived_from_lines:'ยอดที่ระบบรวมเอง',
  unknown:'ยังไม่ทราบที่มาของยอดรวม',
};

export const payoutBasisHelp:Record<PayoutTotalBasis,string>={
  reported_total:'ใช้ยอดรวมจากต้นทางที่เลือกหรือระบุไว้ ยังไม่ใช่หลักฐานเงินเข้าธนาคาร',
  derived_from_lines:'รวมจากรายการในไฟล์ ยังไม่มียอดรวมจากต้นทางเพื่อยืนยันยอดโอน',
  unknown:'ข้อมูลเก่าไม่มีที่มาของยอดรวม หรือรายการในรอบนี้มีที่มาต่างกัน จึงยังยืนยันไม่ได้',
};
