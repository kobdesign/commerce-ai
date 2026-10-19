import { type Page } from '@playwright/test';

/** Follow the same disclosure path as a merchant, including the compact mobile menu. */
export async function openShopPage(page:Page,label:string){
 const nav=page.getByRole('navigation',{name:'เมนูร้านค้า'});
 const toggle=nav.getByRole('button',{name:'เมนูทั้งหมด',exact:true});
 if(await toggle.isVisible())await toggle.click();
 const groupName=['กระทบยอดเงินโอน','คืนเงินและปรับยอด','ค่าใช้จ่ายร้าน','รายการที่ต้องตรวจ'].includes(label)?'เงินและรายการที่ต้องตรวจ':
  ['ทีมและสิทธิ์','ประวัติการทำงาน','รายการรับจากระบบเชื่อมต่อ','สิทธิ์ระบบเชื่อมต่อ','ทดลองหน้าจอช่วยเหลือ'].includes(label)?'ตั้งค่าและเครื่องมือเพิ่มเติม':null;
 if(groupName){
  const group=nav.locator('details').filter({has:page.locator('summary').filter({hasText:groupName})});
  if(await group.getAttribute('open')===null)await group.locator('summary').click();
 }
 await nav.getByRole('link',{name:label,exact:true}).click();
}
