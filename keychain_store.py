"""Store only this application's DeepSeek credential in macOS Keychain.

The secret never goes through process arguments, logs, or a plaintext file.
"""
import ctypes

SERVICE = b'local.job-console.deepseek'
ACCOUNT = b'personal-api-key'


def security():
    library = ctypes.CDLL('/System/Library/Frameworks/Security.framework/Security')
    library.SecKeychainFindGenericPassword.argtypes = [ctypes.c_void_p, ctypes.c_uint32, ctypes.c_char_p, ctypes.c_uint32, ctypes.c_char_p, ctypes.POINTER(ctypes.c_uint32), ctypes.POINTER(ctypes.c_void_p), ctypes.POINTER(ctypes.c_void_p)]
    library.SecKeychainFindGenericPassword.restype = ctypes.c_int32
    library.SecKeychainAddGenericPassword.argtypes = [ctypes.c_void_p, ctypes.c_uint32, ctypes.c_char_p, ctypes.c_uint32, ctypes.c_char_p, ctypes.c_uint32, ctypes.c_void_p, ctypes.POINTER(ctypes.c_void_p)]
    library.SecKeychainAddGenericPassword.restype = ctypes.c_int32
    library.SecKeychainItemModifyAttributesAndData.argtypes = [ctypes.c_void_p, ctypes.c_void_p, ctypes.c_uint32, ctypes.c_void_p]
    library.SecKeychainItemModifyAttributesAndData.restype = ctypes.c_int32
    library.SecKeychainItemFreeContent.argtypes = [ctypes.c_void_p, ctypes.c_void_p]
    return library


def load_key():
    library = security()
    size, data = ctypes.c_uint32(), ctypes.c_void_p()
    status = library.SecKeychainFindGenericPassword(None, len(SERVICE), SERVICE, len(ACCOUNT), ACCOUNT, ctypes.byref(size), ctypes.byref(data), None)
    if status == -25300:  # errSecItemNotFound
        return ''
    if status != 0:
        raise ValueError('无法读取本机钥匙串，请解锁钥匙串后重试（%s）' % status)
    try:
        return ctypes.string_at(data, size.value).decode('utf-8')
    finally:
        library.SecKeychainItemFreeContent(None, data)


def save_key(value):
    library = security()
    core = ctypes.CDLL('/System/Library/Frameworks/CoreFoundation.framework/CoreFoundation')
    core.CFRelease.argtypes = [ctypes.c_void_p]
    item = ctypes.c_void_p()
    status = library.SecKeychainFindGenericPassword(None, len(SERVICE), SERVICE, len(ACCOUNT), ACCOUNT, None, None, ctypes.byref(item))
    encoded = value.encode('utf-8')
    if status == 0:
        try:
            status = library.SecKeychainItemModifyAttributesAndData(item, None, len(encoded), encoded)
        finally:
            core.CFRelease(item)
    elif status == -25300:
        status = library.SecKeychainAddGenericPassword(None, len(SERVICE), SERVICE, len(ACCOUNT), ACCOUNT, len(encoded), encoded, None)
    if status != 0:
        raise ValueError('密钥未能保存到本机钥匙串，请检查系统授权（%s）' % status)
