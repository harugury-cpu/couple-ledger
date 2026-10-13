'use client';
import { createContext, useContext } from 'react';
// 저축 명의 키 a·b를 화면에 보일 이름. 기본 표시는 A와 B이다.
export const OwnerNames = createContext({ a: 'A', b: 'B' });
export const useOwnerNames = () => useContext(OwnerNames);
