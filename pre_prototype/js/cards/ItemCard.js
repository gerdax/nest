// js/cards/ItemCard.js
class ItemCard extends BaseCard {
    constructor(data) {
        super(data);
        this.itemType = this.subType;
    }

    // getNextCardTypes() {
    //     return ['spatial', 'item'];
    // }

    // onAction() {
    //     console.log(`Picked up ${this.subType} item: ${this.id}`);
    //     return true;
    // }
}