// js/cards/BoxCard.js
class BoxCard extends BaseCard {
    constructor(data) {
        super(data);
        this.isLocked = this.subType === 'locked';
        this.isEmpty = false;  // Always start as not empty
        this.hasBeenOpened = false;
        this.items = []; // Store the box items
        console.log(`Box card created: ${this.id} from BoxCard constructor`);
    }

    resetBoxState() {
        this.hasBeenOpened = false; // Reset only hasBeenOpened, keep items state
        this.isEmpty = false;
        console.log(`Reset BOX STATE for ${this.id}`);
    }

    setItems(items) {
        this.items = items;
        this.isEmpty = items.length === 0;
    }

    getItems() {
        return this.items;
    }

    getNextCardTypes(direction) {
        if (this.isEmpty) {
            return ['spatial'];
        }
        
        if (direction === 'right' && !this.hasBeenOpened) {
            this.hasBeenOpened = true;
            return ['box-items'];
        }
        
        return ['spatial'];
    }
}