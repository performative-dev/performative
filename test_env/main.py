from store import KeyValueStore
from utils import display_menu


def main():
    kv_store = KeyValueStore()
    while True:
        display_menu()
        choice = input("Choose an option: ")        if choice == '1':
            key = input("Enter key: ")
            value = input("Enter value: ")

