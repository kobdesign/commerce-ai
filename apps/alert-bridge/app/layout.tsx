import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import './styles.css';

export const metadata:Metadata={
  title:'Commerce Operations — Service Status',
  description:'สถานะบริการรับและตรวจสอบการแจ้งเตือนของ Commerce Operations',
};

export default function RootLayout({children}:{children:ReactNode}){
  return <html lang="th"><body>{children}</body></html>;
}
