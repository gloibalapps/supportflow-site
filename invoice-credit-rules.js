export const CREDIT_PACKS=Object.freeze({casual:{credits:10,priceAUD:7.99},popular:{credits:30,priceAUD:19.99},value:{credits:100,priceAUD:39.99}});
export const FREE_STARTER_CREDITS=5;
// 1 credit is charged the FIRST time a new invoice number is previewed
// (enforced server-side by charge-invoice.mjs + charge_invoice_credit RPC).
// Re-previewing or editing that same invoice number is free.
export const CREDIT_RULES=Object.freeze({expires:true,expiryDays:30,compoundsOnPurchase:true,chargeEvent:"invoice_first_preview",draftsCostCredits:false,firstPreviewCostsCredits:1,previewsCostCredits:false,repreviewsCostCredits:false,editsCostCredits:false,editsBeforeFinalisationCostCredits:false,correctionWindowHours:24,proSeparate:true});
