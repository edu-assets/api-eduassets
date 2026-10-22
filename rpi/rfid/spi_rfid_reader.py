#!/usr/bin/env python3
"""Backend SPI (Raspberry Pi / GPIO nativo) para a interface RfidReaderBase."""
import time
from typing import Optional
import Rfid as MFRC522
from rfid_reader import RfidReaderBase

DEFAULT_KEY = [0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF]

class SpiRfidReader(RfidReaderBase):
    def __init__(self, bus: int = 0, device: int = 0):
        self._reader = MFRC522.Rfid(bus=bus, device=device)

    def _aguardar_cartao(self, timeout_s: Optional[float] = None):
        inicio = time.time()
        while True:
            if timeout_s and (time.time() - inicio) > timeout_s:
                return None
                
            status, _ = self._reader.MFRC522_Request(self._reader.PICC_REQIDL)
            if status == self._reader.MI_OK:
                status, uid = self._reader.MFRC522_Anticoll()
                if status == self._reader.MI_OK:
                    return uid
            
            time.sleep(0.05) # Alivia o uso da CPU durante a espera

    def aguardar_e_ler_bloco(self, bloco: int, timeout_s: Optional[float] = None) -> Optional[bytes]:
        uid = self._aguardar_cartao(timeout_s)
        if not uid:
            return None

        if self._reader.MFRC522_SelectTag(uid) != self._reader.MI_OK:
            return None

        if self._reader.MFRC522_Auth(self._reader.PICC_AUTHENT1A, bloco, DEFAULT_KEY, uid) != self._reader.MI_OK:
            self._reader.MFRC522_StopCrypto1()
            return None

        status, data = self._reader.MFRC522_Read(bloco)
        self._reader.MFRC522_StopCrypto1()
        self._reader.MFRC522_Halt()

        if status != self._reader.MI_OK:
            return None

        return bytes(data)

    def aguardar_e_escrever_bloco(self, bloco: int, dados: bytes, timeout_s: float = 15.0) -> bool:
        if len(dados) != 16:
            raise ValueError("dados deve ter exatamente 16 bytes")

        uid = self._aguardar_cartao(timeout_s)

        if not uid:
            return False
        if self._reader.MFRC522_SelectTag(uid) != self._reader.MI_OK:
            return False

        if self._reader.MFRC522_Auth(self._reader.PICC_AUTHENT1A, bloco, DEFAULT_KEY, uid) != self._reader.MI_OK:
            self._reader.MFRC522_StopCrypto1()
            return False

        ok = self._reader.MFRC522_Write(bloco, list(dados)) == self._reader.MI_OK
        self._reader.MFRC522_StopCrypto1()
        self._reader.MFRC522_Halt()
        return ok

    def close(self) -> None:
        self._reader.close()
