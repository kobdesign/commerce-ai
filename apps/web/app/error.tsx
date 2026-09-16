'use client';
export default function ErrorPage({reset}:{reset:()=>void}){return <div className="empty-state"><h2>เปิดข้อมูลไม่สำเร็จ</h2><p>ลองโหลดหน้านี้อีกครั้ง หากยังเปิดไม่ได้ให้ติดต่อผู้ดูแลระบบ</p><button className="button secondary" onClick={reset}>ลองอีกครั้ง</button><a href="/">กลับหน้าภาพรวม</a></div>;}
