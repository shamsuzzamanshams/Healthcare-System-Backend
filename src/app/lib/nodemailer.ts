import nodemailer from "nodemailer";
import config from "../config";

export const transpoter = nodemailer.createTransport({
    service: "gmail",
    auth:{
        user: config.smtp_user,
        pass: config.smtp_password
    }
})
