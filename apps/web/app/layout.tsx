import type { Metadata } from 'next';
import '@fontsource/noto-sans-thai/400.css';
import '@fontsource/noto-sans-thai/500.css';
import '@fontsource/noto-sans-thai/600.css';
import '@fontsource/noto-sans-thai/700.css';
import './globals.css';
export const metadata:Metadata={title:'Commerce · จัดการร้านค้า',description:'พื้นที่ทำงานสำหรับดูแลข้อมูลร้านค้าและผู้ช่วย AI'};
export default function RootLayout({children}:{children:React.ReactNode}){return <html lang="th"><body>{children}</body></html>;}
