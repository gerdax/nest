class StoryManager {
    constructor() {
        this.passages = new Map();
        this.lastShownCardId = null; // Property to track the last shown card ID
        this.cardTypes = {
            'spatial': SpatialCard,
            'box': BoxCard,
            'item': ItemCard,
            'story': BaseCard
        };
    }

    async loadXLSXStory() {
        try {
            const response = await fetch('story.xlsx');
            const arrayBuffer = await response.arrayBuffer();
            const data = new Uint8Array(arrayBuffer);
            const workbook = XLSX.read(data, { type: 'array' });
            
            const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
            const rows = XLSX.utils.sheet_to_json(firstSheet);
            
            this.passages.clear();
            
            rows.forEach(row => {
                const CardClass = this.cardTypes[row.cardType];
                if (CardClass) {
                    const card = new CardClass(row);
                    this.passages.set(row.cardId, card);
                }
            });

            if (rows.length > 0) {
                this.startPassage = rows[0].cardId;
            }
        } catch (error) {
            console.error('Error loading story:', error);
        }
    }

    getNextCard(currentCard, direction) {
        const directNextCardId = direction === 'left'
            ? currentCard.leftNextCardId
            : currentCard.rightNextCardId;

        if (directNextCardId) {
            const directNextCard = this.passages.get(directNextCardId);
            if (directNextCard) {
                this.lastShownCardId = directNextCard.id;
                return directNextCard;
            }
        }

        const possibleTypes = currentCard.getNextCardTypes(direction);

        // Special handling for box opening
        if (possibleTypes.includes('box-items')) {
         
            return {
                type: 'box-items',
                boxCard: currentCard
            };
        }
        
        // Regular card selection logic...
        const possibleCards = Array.from(this.passages.values())
            .filter(card => possibleTypes.includes(card.cardType) && card.id !== this.lastShownCardId);
        
        if (possibleCards.length === 0) {
            return null;
        }
    
        // Weight cards by inverse rarity (1 is most common, so gets highest weight)
        const weightedCards = possibleCards.flatMap(card => {
            // Weight formula: 6-rarity gives weights of 5,4,3,2,1 for rarities 1,2,3,4,5
            const weight = 6 - card.rarity;
            // Repeat card in array based on weight
            return Array(weight).fill(card);
        });
    
        const nextCard = weightedCards[Math.floor(Math.random() * weightedCards.length)];
        this.lastShownCardId = nextCard.id;
        return nextCard;
    }

    getPassage(cardId) {
        return this.passages.get(cardId);
    }

    getStartPassage() {
        return this.startPassage;
    }
}

window.storyManager = new StoryManager();
