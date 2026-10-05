// js/cards/BaseCard.js
class BaseCard {
    constructor(data) {
        this.id = data.cardId;
        this.cardType = data.cardType;
        this.subType = data.subType;
        this.text = data.mainText;
        this.image = data.backgroundImage;
        this.leftChoice = data.leftChoiceText;
        this.rightChoice = data.rightChoiceText;
        this.leftNextCardId = data.leftNextCardId;
        this.rightNextCardId = data.rightNextCardId;
        this.rarity = data.rarity || 1; // Default to common (1) if not specified
        console.log(`Created: ${this.id}`);
    }

    getNextCardTypes() {
        return [];
    }
    logCardDetails() {
        console.log(`Card Type: ${this.cardType}, Subtype: ${this.subType}, Name: ${this.id}, Rarity: ${this.rarity}`);
    }
    // onAction() {
    //     baseCard.logCardDetails(); // Logs: Card Type: base, Subtype: example
    // }


}
