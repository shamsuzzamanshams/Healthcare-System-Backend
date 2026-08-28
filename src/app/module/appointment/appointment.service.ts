import { success } from "zod";
import config from "../../config";
import { getBkashToken } from "../../lib/bkash";

const bookAppointment = async () => {
	const bkashIdToken = await getBkashToken();

	if (!bkashIdToken) {
		throw new Error("No bkash access token found!");
	}
	const bkashCreatePaymentResponse = await fetch(
		`${config.bkash_base_url}/tokenized/checkout/create`,
		{
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Accept: "application/json",
				Authorization: bkashIdToken,
				"X-App-Key": config.bkash_app_key,
			},

			body: JSON.stringify({
				mode: "0011",
				payerReference: "01723888888",
				callbackURL: `${config.bkash_callback_url}/appointment/book-appointment/payment/callback`,
				merchantAssociationInfo: "MI05MID54RF09123456One",
				amount: "1200",
				currency: "BDT",
				intent: "sale",
				merchantInvoiceNumber: "Inv0124",
			}),
		});

    const bkashCreatePaymentResult = await bkashCreatePaymentResponse.json()

    return bkashCreatePaymentResult
};

const bookAppointmentCallback = () =>{
    return{
        success: true
    }
}

export const AppointmentService = {
	bookAppointment,
    bookAppointmentCallback
};
