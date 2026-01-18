from store import KeyValueStore


def main():
    kv_store = KeyValueStore()    kv_store.set('name', 'Alice')
    print(kv_store.get('name'))
    kv_store.delete('name')
    print(kv_store.get('name'))

